const { Authenticator, GraphQLClient } = require('leanix-js')
const { instance = null, apiToken = null } = process.env

if (instance === null) throw Error('ENVAR instance is not defined')
if (apiToken === null) throw Error('ENVAR apiToken is not defined')

const authenticator = new Authenticator(instance, apiToken)
const graphql = new GraphQLClient(authenticator)

const generateBcMaps = async () => {
  const maxHierarchyLevel = 4
  let query = `
  {
    allFactSheets(filter: {facetFilters: [{facetKey: "FactSheetTypes", keys: ["BusinessCapability"]}, {facetKey: "hierarchyLevel", keys: ["1"]}]}, sort: [{key: "level", order: desc}]) {
      edges {
        node {
          id
          type
          name
          description
          level
          {{children}}
        }
      }
    }
  }
  `.replace(/\s\s+/g, ' ')
  const childrenFragment = '...on BusinessCapability { children:relToChild { edges { node { id factSheet { id type name description level {{children}} } } } } }'
  query = [...Array(maxHierarchyLevel).keys()]
    .reduce((accumulator, _, level) => accumulator.replace('{{children}}', level < (maxHierarchyLevel - 1) ? childrenFragment : ''), query)

  const unrollChildren = node => {
    let { id, description = null, factSheet = null, children: { edges: children = null } = {} } = node
    if (children === null && factSheet !== null) ({ description = null, children: { edges: children = [] } = {} } = factSheet)
    if (description === null) description = '{}'
    try {
      description = JSON.parse(description === null ? '{}' : description)
    } catch (error) {
      console.error(error)
      description = {}
    }

    const { childrenOrder = [] } = description
    if (childrenOrder.length) {
      const childIdx = childrenOrder.reduce((accumulator, factSheetId, i) => ({ ...accumulator, [factSheetId]: i }), {})
      children = children.sort(({ node: { factSheet: { id: A } } }, { node: { factSheet: { id: B } } }) => {
        const idxA = childIdx[A]
        const idxB = childIdx[B]
        return idxA < idxB ? -1 : idxA > idxB ? 1 : 0
      })
    }

    children = children.map(({ node }) => unrollChildren(node))
    node = { ...(factSheet === null ? node : factSheet), relToParentId: factSheet === null ? null : id, children }
    delete node.description
    return { ...node, ...description }
  }

  try {
    await authenticator.start()
    const bcMaps = await graphql.executeGraphQL(query)
      .then(({ allFactSheets: { edges } }) => edges.map(({ node }) => unrollChildren(node)))
      .then(bcMaps => bcMaps.filter(({ published }) => !!published))
    const { workspaceId, instance } = authenticator
    return { workspaceId, instance, timestamp: new Date().toISOString(), bcMaps }
  } finally {
    authenticator.stop()
  }
}

const rebuildBcMaps = async transactionSequenceNumber => {
  const bcMaps = await generateBcMaps()
  if (transactionSequenceNumber) bcMaps.transactionSequenceNumber = transactionSequenceNumber
  console.log(`${new Date().toISOString()} #${transactionSequenceNumber || 0} - updated bcMaps.json`)
  return bcMaps
}

// authenticator.start()
// authenticator.on('authenticated', () => rebuildBcMaps())
// authenticator.on('error', err => console.error('authentication error', err))

module.exports = {
  authenticator,
  graphql,
  generateBcMaps,
  rebuildBcMaps
}
