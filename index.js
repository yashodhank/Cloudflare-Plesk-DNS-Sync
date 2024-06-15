const fetch = require('node-fetch');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const winston = require('winston');
const { program } = require('commander');
const { exec } = require('child_process');
dotenv.config();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const transporter = nodemailer.createTransport({
  host: process.env.HOST,
  port: 465,
  secure: true,
  auth: {
    user: process.env.SENDER,
    pass: process.env.SPASS,
  },
});

let message = [];

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(res => setTimeout(res, 1000 * (i + 1))); // Exponential backoff
    }
  }
}

async function grabDomainNames() {
  try {
    const data = await fetchWithRetry(`https://${process.env.PLESKURL}/api/v2/domains`, {
      method: "GET",
      headers: {
        'X-API-Key': process.env.PLESKKEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    return data.map(domain => domain.name);
  } catch (error) {
    logger.error('Error fetching domain names from Plesk:', error);
    return [];
  }
}

let domainInfo = [];

async function grabCloudflareDomains() {
  let domains = [];
  try {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const data = await fetchWithRetry(`https://api.cloudflare.com/client/v4/zones?match=all&account.id=${process.env.CLOUDACCOUNTID}&page=${page}`, {
        method: 'GET',
        headers: {
          'X-Auth-Email': process.env.CLOUDEMAIL,
          'X-Auth-Key': process.env.CLOUDKEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      totalPages = data.result_info.total_pages;
      domainInfo.push(...data.result);
      domains.push(...data.result.map(domain => domain.name));
      page++;
    }
  } catch (error) {
    logger.error('Error fetching domain names from Cloudflare:', error);
  }
  return domains;
}

async function filterDomains() {
  const [cloudflareDomains, pleskDomains] = await Promise.all([grabCloudflareDomains(), grabDomainNames()]);
  return cloudflareDomains.filter(domain => pleskDomains.includes(domain));
}

async function getDNSRecords(domains) {
  const records = await Promise.all(domains.map(async domain => {
    try {
      const data = await fetchWithRetry(`https://${process.env.PLESKURL}/api/v2/cli/dns/call`, {
        method: 'POST',
        headers: {
          'X-API-Key': process.env.PLESKKEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ "params": ["--info", domain] }),
      });
      return data.stdout.split("\n").filter(record => record.includes("_acme-challenge")).map(record => record.split(' '));
    } catch (error) {
      logger.error(`Error fetching DNS records for domain ${domain}:`, error);
      return [];
    }
  }));
  return records.flat();
}

async function mergeDNS(records) {
  const results = await Promise.all(records.map(async record => {
    const zone = record[4];
    try {
      const data = await fetchWithRetry(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?type=TXT&name=_acme-challenge.${record[5]}`, {
        method: 'GET',
        headers: {
          'X-Auth-Email': process.env.CLOUDEMAIL,
          'X-Auth-Key': process.env.CLOUDKEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      if (!data.result[0]) {
        record.push("create");
      } else {
        record.push(data.result[0].id);
        record.push(data.result[0].content);
      }
    } catch (error) {
      logger.error('Error checking DNS records on Cloudflare:', error);
    }
    return record;
  }));
  return results;
}

async function updateDNSRecord(record) {
  const zone = record[4];
  const dnsData = {
    type: record[1],
    name: record[0],
    content: record[3],
    ttl: 1,
  };

  try {
    if (record[6] === 'create') {
      await fetchWithRetry(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`, {
        method: 'POST',
        headers: {
          'X-Auth-Email': process.env.CLOUDEMAIL,
          'X-Auth-Key': process.env.CLOUDKEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dnsData),
      });
    } else if (record[3] !== record[7]) {
      await fetchWithRetry(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records/${record[6]}`, {
        method: 'PUT',
        headers: {
          'X-Auth-Email': process.env.CLOUDEMAIL,
          'X-Auth-Key': process.env.CLOUDKEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dnsData),
      });
    } else {
      logger.info("No update needed for this record");
    }
  } catch (error) {
    logger.error('Error updating DNS record on Cloudflare:', error);
  }
}

async function renewSSLCertificates(domains) {
  for (const domain of domains) {
    try {
      exec(`certbot renew --domain ${domain}`, (error, stdout, stderr) => {
        if (error) {
          logger.error(`Error renewing SSL certificate for ${domain}: ${error.message}`);
          return;
        }
        if (stderr) {
          logger.warn(`Stderr output for ${domain}: ${stderr}`);
        }
        logger.info(`SSL certificate renewed for ${domain}: ${stdout}`);
        // Update DNS records on Cloudflare if necessary
        updateDNSRecord(domain);
      });
    } catch (error) {
      logger.error(`Error during SSL certificate renewal for ${domain}:`, error);
    }
  }
}

async function cleanupDNSRecords() {
  const activeDomains = await grabDomainNames();
  const cloudflareDomains = await grabCloudflareDomains();

  const inactiveDomains = cloudflareDomains.filter(domain => !activeDomains.includes(domain));

  for (const domain of inactiveDomains) {
    try {
      const zone = domainInfo.find(info => info.name === domain).id;
      const records = await fetchWithRetry(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`, {
        method: 'GET',
        headers: {
          'X-Auth-Email': process.env.CLOUDEMAIL,
          'X-Auth-Key': process.env.CLOUDKEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      for (const record of records.result) {
        await fetchWithRetry(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records/${record.id}`, {
          method: 'DELETE',
          headers: {
            'X-Auth-Email': process.env.CLOUDEMAIL,
            'X-Auth-Key': process.env.CLOUDKEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });
        logger.info(`Deleted DNS record ${record.name} for inactive domain ${domain}`);
      }
    } catch (error) {
      logger.error(`Error cleaning up DNS records for ${domain}:`, error);
    }
  }
}

async function updateDNS() {
  const domains = await filterDomains();
  const records = await getDNSRecords(domains);
  const mergedRecords = await mergeDNS(records);

  await Promise.all(mergedRecords.map(updateDNSRecord));

  message.push(mergedRecords);
  await sendEmail();
}

async function sendEmail() {
  try {
    const info = await transporter.sendMail({
      from: `"DNSBOT" <${process.env.SENDER}>`,
      to: process.env.EMAIL,
      subject: `DNS updates ${new Date()}`,
      text: message.join("\n"),
    });
    logger.info("Message sent:", info.messageId);
  } catch (error) {
    logger.error('Error sending email:', error);
  }
}

if (require.main === module) {
  program
    .command('run')
    .description('Run the DNS update process')
    .action(() => {
      updateDNS();
    });

  program
    .command('setup')
    .description('Setup environment variables')
    .action(() => {
      require('./setup');
    });

  program
    .command('cleanup')
    .description('Clean up stale DNS records on Cloudflare')
    .action(() => {
      cleanupDNSRecords();
    });

  program
    .command('renew-ssl')
    .description('Renew SSL certificates for domains on Plesk')
    .action(async () => {
      const domains = await grabDomainNames();
      renewSSLCertificates(domains);
    });

  program.parse(process.argv);

  if (process.argv.length < 3) {
    program.outputHelp();
  }
}

module.exports = {
  fetchWithRetry,
  grabDomainNames,
  grabCloudflareDomains,
  filterDomains,
  getDNSRecords,
  mergeDNS,
  updateDNSRecord,
  renewSSLCertificates,
  cleanupDNSRecords,
  updateDNS,
  sendEmail
};
