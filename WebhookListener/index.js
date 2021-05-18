const { v4: uuidv4 } = require('uuid')
const { rebuildBcMaps, publishToHubspot } = require('./businessLogic')
const auth = require('basic-auth')
const { LEANIX_USERNAME: username = null, LEANIX_PASSWORD: password = null } = process.env

// Initialize global variables for reuse in future calls
let lastTransaction = -1
let bcMaps = null
let fileUrl = null

module.exports = async function (context, req) {
  if (username === null || password === null) context.warn('APP Settings "LEANIX_USERNAME" and "LEANIX_PASSWORD" should be set for basic auth of POST requests')
  const { method = null, body: { type, transactionSequenceNumber, factSheet: { type: fsType } = {} } = {} } = req

  if (method === 'GET') {
    if (bcMaps === null) {
      try {
        bcMaps = await rebuildBcMaps(lastTransaction, context)
        fileUrl = await publishToHubspot(bcMaps, lastTransaction, context)
      } catch (error) {
        const timestamp = new Date().toISOString()
        const errorId = uuidv4()
        context.error(errorId, timestamp, error)
        context.res = { status: 500, body: JSON.stringify({ status: 500, timestamp, errorId, message: 'Something went wrong... Please contact customer support.' }, null, 2) }
        return
      }
    }
    context.res = {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...bcMaps, fileUrl }, null, 2)
    }
  } else if ((type === 'FactSheetUpdatedEvent') && (fsType === 'BusinessCapability') && (lastTransaction < transactionSequenceNumber)) {
    if (username !== null && password !== null) {
      const { name: providedUsername = null, pass: providedPassword = null } = auth(req) || {}
      if (providedUsername !== username || providedPassword !== password) {
        const { headers: { 'x-forwarded-for': forwardedFor } } = req
        context.res = { status: 403, body: 'invalid credentials' }
        context.error(new Date().toISOString(), '403 Forbidden', forwardedFor)
        return
      }
    }
    try {
      bcMaps = await rebuildBcMaps(transactionSequenceNumber, context)
      fileUrl = await publishToHubspot(bcMaps, transactionSequenceNumber, context)
      context.log(`${new Date().toISOString()} bcMaps.json updated! #${transactionSequenceNumber} (last was #${lastTransaction}) - ${type} - ${fsType}`)
      lastTransaction = transactionSequenceNumber
    } catch (error) {
      const timestamp = new Date().toISOString()
      const errorId = uuidv4()
      context.error(errorId, error)
      context.res = { status: 500, body: JSON.stringify({ status: 500, timestamp, errorId, message: 'Something went wrong... Please contact customer support.' }, null, 2) }
    }
  }
}
