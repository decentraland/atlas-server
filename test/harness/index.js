const { resolve } = require("path")
process.env.TS_NODE_PROJECT = resolve(__dirname, "../tsconfig.json")

// load ts-node
require("ts-node/register")