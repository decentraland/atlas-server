export type District = {
  id: string
  name: string
  description: string
  parcels: string[]
  totalParcels: number
}

export type Contribution = {
  address: string
  districtId: string
  totalParcels: number
}

export interface IDistrictComponent {
  getDistricts: () => District[]
  getDistrict: (id: string) => District | null
  getContributionsByAddress: (address: string) => Contribution[]
}
