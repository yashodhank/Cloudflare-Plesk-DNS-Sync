// index.js
const {
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
} = require('./core');

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
