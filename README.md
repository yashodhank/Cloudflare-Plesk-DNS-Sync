# !!DO NOT USE THIS PROJECT IS IT NEVER TESTED FOR IT WORKING!!
----
# Cloudflare-Plesk-DNS-Sync

This project synchronizes ACME TXT records between Cloudflare and Plesk, renews SSL certificates, and cleans up stale DNS records. It is designed to run autonomously and can be executed either directly or within a Docker container.

## Features

- Synchronizes ACME TXT records between Cloudflare and Plesk
- Automatically renews SSL certificates for Plesk domains
- Cleans up stale or outdated DNS records on Cloudflare without affecting records created or updated manually by human operators or by other automation
- Monitors domain health and sends alerts for any issues
- Manages domain redirection and DDoS protection settings
- Backs up and restores DNS configurations for autonomous operations and archiving for human-aided troubleshooting

## Installation

### Prerequisites

- Node.js (v16 or later)
- npm
- Docker (optional, for containerized deployment)

### Setup

1. Clone the repository:

    ```sh
    git clone https://github.com/yashodhank/Cloudflare-Plesk-DNS-Sync.git
    cd Cloudflare-Plesk-DNS-Sync
    ```

2. Install dependencies:

    ```sh
    npm install
    ```

3. Create a `.env` file based on the `.env.example`:

    ```sh
    cp .env.example .env
    ```

4. Fill in the `.env` file with your configuration details:

    ```env
    PLESKKEY=<your-plesk-api-key>
    CLOUDKEY=<your-cloudflare-api-key>
    CLOUDEMAIL=<your-cloudflare-email>
    CLOUDACCOUNTID=<your-cloudflare-account-id>
    PLESKURL=<your-plesk-url>
    EMAIL=<your-email>
    SENDER=<sender-email>
    SPASS=<sender-password>
    HOST=<email-host>
    ```

## Usage

### Running Directly

To run the DNS synchronization process directly:

```sh
node cli.js run
```

To renew SSL certificates:

```sh
node cli.js renew-ssl
```

To clean up stale DNS records:

```sh
node cli.js cleanup
```

To monitor domain health:

```sh
node cli.js monitor-health
```

To manage redirection and DDoS protection:

```sh
node cli.js manage-settings
```

To back up DNS configurations:

```sh
node cli.js backup
```

To restore DNS configurations:

```sh
node cli.js restore
```

### Running in Docker

#### Building the Docker Image

1. Build the Docker image:

    ```sh
    docker build -t cloudflare-plesk-dns-sync .
    ```

2. Run the Docker container:

    ```sh
    docker run --env-file .env cloudflare-plesk-dns-sync
    ```

#### Pulling the Docker Image from GitHub Packages

1. Authenticate to GitHub Packages:

    ```sh
    echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin
    ```

2. Pull the Docker image:

    ```sh
    docker pull ghcr.io/yashodhank/cloudflare-plesk-dns-sync:latest
    ```

3. Run the Docker container:

    ```sh
    docker run --env-file .env ghcr.io/yashodhank/cloudflare-plesk-dns-sync:latest
    ```

## Testing

Run the tests using Jest:

```sh
npm test
```

## Continuous Integration

This project uses GitHub Actions for continuous integration and deployment. The workflow is defined in `.github/workflows/docker.yml` and performs the following tasks:

- Checks out the repository
- Sets up Node.js
- Installs dependencies
- Runs tests
- Builds and pushes a Docker image to GitHub Container Registry

### GitHub Actions Workflow

```yaml
name: Build, Test, and Publish Docker Image

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

permissions:
  contents: read
  packages: write

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
    - name: Checkout repository
      uses: actions/checkout@v2

    - name: Set up Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '16'

    - name: Install dependencies


      run: npm install

    - name: Run tests
      run: npm test

    - name: Set up QEMU
      uses: docker/setup-qemu-action@v2

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v2

    - name: Log in to GitHub Container Registry
      run: echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin

    - name: Build and push Docker image
      uses: docker/build-push-action@v3
      with:
        push: true
        tags: ghcr.io/${{ github.repository_owner }}/cloudflare-plesk-dns-sync:latest
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any changes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.