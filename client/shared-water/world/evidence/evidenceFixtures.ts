export interface EvidenceRecord {
  id: string

  source: string
  sourceUrl?: string

  observation?: string

  eventAt?: string
  sourceLocalTime?: string
  effectiveAt?: string
  observedAt?: string
  receivedAt?: string

  fetchedAt?: string

  method?: string

  attribution?: string

  limitation?: string
}
