// cli.js
const { program } = require('commander');
const {
  updateDNS,
  renewSSLCertificates,
  cleanupDNSRecords,
  grabDomainNames
} = require('./core');

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
