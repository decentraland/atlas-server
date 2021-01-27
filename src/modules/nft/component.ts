

import { Tile } from '../map/types'
import { getProximity, capitalize } from './utils'
import { INFTComponent, NFT, Attribute } from './types'


export function getParcelFromTile(tile: Tile): NFT {
  const { x, y, parcel: { name, description, tokenId, contractAddress } } = tile
  const attributes: Attribute[] = [
    {
      trait_type: 'X',
      value: x,
      display_type: 'number',
    },
    {
      trait_type: 'Y',
      value: y,
      display_type: 'number',
    },
  ]

  const proximity = getProximity([{ x, y }])
  if (proximity) {
    for (const key of Object.keys(proximity)) {
      attributes.push({
        trait_type: `Distance to ${capitalize(key)}`,
        value: parseInt((proximity as any)[key], 10),
        display_type: 'number',
      })
    }
  }

  return {
    name: name || `Parcel ${x},${y}`,
    description: (description) || '',
    image: `https://api.decentraland.org/v1/parcels/${x}/${y}/map.png?size=24&width=1024&height=1024`,
    external_url: `https://market.decentraland.org/contracts/${contractAddress}/tokens/${tokenId}`,
    attributes,
    background_color: '000000',
  }
}

export function getEstateFromTile(tiles: Tile[]): NFT {
  const { name, size, description, tokenId, contractAddress } = tiles[0].estate!
  const attributes: Attribute[] = [
    {
      trait_type: 'Size',
      value: size,
      display_type: 'number',
    },
  ]

  const coordinates = tiles.map(tiles => ({ x: tiles.x, y: tiles.y }))
  const proximity = getProximity(coordinates)
  if (proximity) {
    for (const key of Object.keys(proximity)) {
      attributes.push({
        trait_type: `Distance to ${capitalize(key)}`,
        value: parseInt((proximity as any)[key], 10),
        display_type: 'number',
      })
    }
  }

  return {
    name: name || '',
    description: (description) || '',
    image: `https://api.decentraland.org/v1/estates/${tokenId}/map.png?size=24&width=1024&height=1024`,
    external_url: `https://market.decentraland.org/contracts/${contractAddress}/tokens/${tokenId}`,
    attributes,
    background_color: '000000',
  }
}

export function getNFTFromTile(tiles: Tile[]): NFT {
  if (tiles[0].estate) {
    return getEstateFromTile(tiles)
  } else {
    return getParcelFromTile(tiles[0])
  }
}


export function createNFTComponent(): INFTComponent {
  return {
    getParcelFromTile,
    getEstateFromTile,
    getNFTFromTile
  }
}