import Cloudflare from 'cloudflare'

const client = new Cloudflare()

export async function createDomainRecord(domainPrefix: string) {
  try {
    const result = await client.dns.records.create({
      type: 'CNAME',
      name: domainPrefix,
      zone_id: process.env.CLOUDFLARE_ZONE_ID as string,
      proxied: false,
      content: 'cname.vercel-dns.com.'
    })
    if (!result.id) throw new Error('Failed to create DNS record')
    return result.id
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export async function deleteDomainRecord(dnsRecordId: string) {
  try {
    await client.dns.records.delete(dnsRecordId, {
      zone_id: process.env.CLOUDFLARE_ZONE_ID as string,
    })
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}