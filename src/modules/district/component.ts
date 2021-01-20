import { Contribution, District, IDistrictComponent } from './types'
import districtsJson from './data/districts.json'
import contributionsJson from './data/contributions.json'

const districts = districtsJson as District[]
const contributions = contributionsJson as Record<string, Contribution[]>

export function createDistrictComponent(): IDistrictComponent {
  return {
    getDistricts: () => districts,
    getDistrict: (id) =>
      districts.find((district) => district.id === id) || null,
    getContributionsByAddress: (address) => contributions[address] || [],
  }
}
