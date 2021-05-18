const { Authenticator, GraphQLClient } = require('leanix-js')
const { LEANIX_INSTANCE: instance = null, LEANIX_APITOKEN: apiToken = null, HUBSPOT_API_KEY: hsApiKey = null, HUBSPOT_FOLDER: hsFolder = '' } = process.env
if (instance === null) throw Error('App Setting LEANIX_INSTANCE is not defined!')
if (apiToken === null) throw Error('App Setting LEANIX_APITOKEN is not defined!')
if (hsApiKey === null) throw Error('App Settings "HUBSPOT_API_KEY" not defined (Hubspot api key)! Published bcmaps.json will not be updated...')
if (hsFolder === null) console.warn('App Settings "HUBSPOT_FOLDER" not defined! Defaulting to root folder...')

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

const publishToHubspot = async (bcMaps, transactionSequenceNumber) => {
  if (hsApiKey == null) throw Error('App Settings "HUBSPOT_API_KEY" not defined (Hubspot api key)! Published bcmaps.json will not be updated...')
  const form = new FormData()
  form.append('file', Buffer.from(JSON.stringify(bcMaps), 'utf-8'), { contentType: 'application/json', name: 'file', filename: 'bcmaps.json' })
  form.append('folderPath', hsFolder)
  form.append('options', JSON.stringify({ access: 'PUBLIC_INDEXABLE', overwrite: true }))
  const options = { method: 'POST', body: form }
  const response = await fetch(`https://api.hubapi.com/files/v3/files?hapikey=${hsApiKey}`, options)
  const { ok, status: statusCode } = response
  const data = await response.json()
  if (ok && statusCode === 201) {
    const fileUrl = data.url
    console.log(`${new Date().toISOString()} #${transactionSequenceNumber || 0} - published bcMaps.json @ ${fileUrl}`)
    return fileUrl
  } else throw Error(JSON.stringify({ statusCode, ...data }))
}

module.exports = {
  authenticator,
  graphql,
  generateBcMaps,
  rebuildBcMaps,
  publishToHubspot
}
