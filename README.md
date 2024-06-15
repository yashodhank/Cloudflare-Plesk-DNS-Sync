# Cloudflare-Plesk-DNS-Sync

A script to synchronize ACME TXT records between Cloudflare and Plesk and provide additional DNS management automation.

## Features

- Synchronize ACME TXT records between Cloudflare and Plesk
- Automatically renew SSL certificates for Plesk domains
- Clean up stale or outdated DNS records on Cloudflare
- Monitor domain health and send alerts for any issues
- Manage domain redirection and DDoS protection settings
- Backup and restore DNS configurations
- Dynamic DNS updates for changing IP addresses
- Email notifications and detailed reports
- API integration for enhanced DNS management
- Custom DNS record management
- DNSSEC configuration and management
- Webhook integration for event-triggered automation

## Installation

### Prerequisites

- Node.js (v14 or higher)
- Docker (optional, for containerized deployment)
- Certbot (for SSL certificate renewal)

### Setup

1. Clone the repository:
   ```sh
   cd /opt/
   git clone https://github.com/yashodhank/Cloudflare-Plesk-DNS-Sync.git 
   cd /opt/Cloudflare-Plesk-DNS-Sync
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

3. Run the setup script to configure your environment variables:
   ```sh
   npm run setup
   ```

4. Build and run the Docker container (optional):
   ```sh
   docker build -t cloudflare-plesk-dns-sync .
   docker run --env-file .env cloudflare-plesk-dns-sync
   ```

### Usage

1. To run the DNS update process, use:
   ```sh
   npm start
   ```

2. To manually run the setup again:
   ```sh
   npm run setup
   ```

3. To clean up stale DNS records:
   ```sh
   npm run cleanup
   ```

4. To renew SSL certificates:
   ```sh
   npm run renew-ssl
   ```

### Environment Variables

The setup script will prompt you to enter the following environment variables:

- `PLESKKEY`: Plesk API Key
- `PLESKURL`: Plesk URL
- `CLOUDKEY`: Cloudflare API Key
- `CLOUDEMAIL`: Cloudflare Email
- `CLOUDACCOUNTID`: Cloudflare Account ID
- `EMAIL`: Notification email
- `SENDER`: Sender email address
- `SPASS`: Sender email password
- `HOST`: SMTP host

### Logging

Logs will be saved to `error.log` for errors and `combined.log` for general logs.

### Cron Job

To run the script periodically (e.g., every night), add the following entry to your crontab:
```sh
crontab -e
```
Then add:
```sh
0 3 * * * cd /opt/Cloudflare-Plesk-DNS-Sync && npm start
```

### License

This project is licensed under the MIT License.
