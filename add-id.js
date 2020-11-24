const path = require('path')
const fs = require('fs')

const data = fs.readFileSync(
  path.resolve(__dirname, './src/data/specialTiles.json'),
  'utf8'
)
const json = JSON.parse(data)

for (const id of Object.keys(json)) {
  json[id].id = id
}

fs.writeFileSync(
  path.resolve(__dirname, './src/data/specialTiles2.json'),
  JSON.stringify(json, null, 2),
  'utf8'
)
