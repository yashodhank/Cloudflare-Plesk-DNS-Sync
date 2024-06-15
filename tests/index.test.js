const fetch = require('node-fetch');
jest.mock('node-fetch');

const {
  grabDomainNames,
  grabCloudflareDomains
} = require('../core');

describe('Test grabDomainNames', () => {
  it('should fetch domain names from Plesk', async () => {
    fetch.mockResolvedValueOnce({
      json: async () => [{ name: 'example.com' }]
    });

    const domains = await grabDomainNames();
    expect(domains).toEqual(['example.com']);
  });
});

describe('Test grabCloudflareDomains', () => {
  it('should fetch domain names from Cloudflare', async () => {
    fetch.mockResolvedValueOnce({
      json: async () => ({
        result: [{ name: 'example.com', id: 'zone-id' }],
        result_info: { total_pages: 1 }
      })
    });

    const domains = await grabCloudflareDomains();
    expect(domains).toEqual(['example.com']);
  });
});
