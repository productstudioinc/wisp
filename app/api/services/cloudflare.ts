import Cloudflare from 'cloudflare'

export const cloudflareClient = new Cloudflare()

export async function createDomainRecord(domainPrefix: string) {
  try {
    const result = await cloudflareClient.dns.records.create({
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
    await cloudflareClient.dns.records.delete(dnsRecordId, {
      zone_id: process.env.CLOUDFLARE_ZONE_ID as string,
    })
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}