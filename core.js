const fetch = require('node-fetch');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const winston = require('winston');
const { exec } = require('child_process');
const fs = require('fs');

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

let transporter;
if (process.env.HOST && process.env.SENDER && process.env.SPASS) {
  transporter = nodemailer.createTransport({
    host: process.env.HOST,
    port: 465,
    secure: true,
    auth: {
      user: process.env.SENDER,
      pass: process.env.SPASS,
    },
  });
}

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
        // Check if the record was created by this script
        if (record.metadata && record.metadata.autoGenerated) {
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
      }
    } catch (error) {
      logger.error(`Error cleaning up DNS records for ${domain}:`, error);
    }
  }
}

async function monitorDomainHealth() {
  const domains = await grabDomainNames();
  for (const domain of domains) {
    try {
      const response = await fetch(`http://${domain}`, { method: 'HEAD' });
      if (!response.ok) {
        throw new Error(`Domain health check failed for ${domain}`);
      }
      logger.info(`Domain ${domain} is healthy`);
    } catch (error) {
      logger.error(`Domain health check error for ${domain}: ${error.message}`);
      sendAlertEmail(domain, error.message);
    }
  }
}

async function sendAlertEmail(domain, message) {
  if (!transporter) {
    logger.warn('Email settings not configured. Skipping email.');
    return;
  }

  try {
    await transporter.sendMail({
      from: `"DNSBOT" <${process.env.SENDER}>`,
      to: process.env.EMAIL,
      subject: `Alert: Issue detected with domain ${domain}`,
      text: message,
    });
    logger.info(`Alert email sent for domain ${domain}`);
  } catch (error) {
    logger.error('Error sending alert email:', error);
  }
}

async function manageRedirectionAndDDoSProtection() {
  const domains = await grabDomainNames();
  for (const domain of domains) {
    try {
      // Set redirection settings
      await fetchWithRetry(`https://api.cloudflare.com/client/v4/zones/${domainInfo.find(info => info.name === domain).id}/settings/redirects`, {
        method: 'PATCH',
        headers: {
          'X-Auth-Email': process.env.CLOUDEMAIL,
          'X-Auth-Key': process.env.CLOUDKEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'enabled' }),
      });
      // Enable DDoS protection
      await fetchWithRetry(`https://api.cloudflare.com/client/v4/zones/${domainInfo.find(info => info.name === domain).id}/settings/ddos_protection`, {
        method: 'PATCH',
        headers: {
          'X-Auth-Email': process.env.CLOUDEMAIL,
          'X-Auth-Key': process.env.CLOUDKEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'enabled' }),
      });
      logger.info(`Redirection and DDoS protection settings updated for ${domain}`);
    } catch (error) {
      logger.error(`Error updating settings for ${domain}:`, error);
    }
  }
}

async function backupDNSConfigurations() {
  const domains = await grabCloudflareDomains();
  const backups = {};
  for (const domain of domains) {
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
      backups[domain] = records.result;
    } catch (error) {
      logger.error(`Error backing up DNS records for ${domain}:`, error);
    }
  }
  fs.writeFileSync('dns_backup.json', JSON.stringify(backups, null, 2));
  logger.info('DNS configurations backed up');
}

async function restoreDNSConfigurations() {
  const backups = JSON.parse(fs.readFileSync('dns_backup.json'));
  for (const domain in backups) {
    const zone = domainInfo.find(info => info.name === domain).id;
    for (const record of backups[domain]) {
      try {
        await fetchWithRetry(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`, {
          method: 'POST',
          headers: {
            'X-Auth-Email': process.env.CLOUDEMAIL,
            'X-Auth-Key': process.env.CLOUDKEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(record),
        });
      } catch (error) {
        logger.error(`Error restoring DNS record for ${domain}:`, error);
      }
    }
    logger.info(`DNS configurations restored for ${domain}`);
  }
}

async function updateDNS() {
  const domains = await filterDomains();
  const records = await getDNSRecords(domains);
  const mergedRecords = await mergeDNS(records);

  await Promise.all(mergedRecords.map(updateDNSRecord));

  message.push(mergedRecords);
  await sendEmail(`DNS updates ${new Date()}`, message.join("\n"));
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
  monitorDomainHealth,
  manageRedirectionAndDDoSProtection,
  backupDNSConfigurations,
  restoreDNSConfigurations,
  updateDNS,
  sendEmail
};
