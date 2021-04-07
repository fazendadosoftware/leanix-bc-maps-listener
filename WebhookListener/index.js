const { v4: uuidv4 } = require('uuid')
const { rebuildBcMaps } = require('./businessLogic')
const auth = require('basic-auth')
const { LEANIX_USERNAME: username = null, LEANIX_PASSWORD: password = null } = process.env
if (username === null || password === null) console.warn('APP Settings "LEANIX_USERNAME" and "LEANIX_PASSWORD" should be set for basic auth of POST requests')

// Initialize global variables for reuse in future calls
let lastTransaction = -1
let bcMaps = null

module.exports = async function (context, req) {
  const { method = null, body: { type, transactionSequenceNumber, factSheet: { type: fsType } = {} } = {} } = req

  if (method === 'GET') {
    if (bcMaps === null) {
      try {
        bcMaps = await rebuildBcMaps(lastTransaction)
      } catch (error) {
        const timestamp = new Date().toISOString()
        const errorId = uuidv4()
        console.error(errorId, timestamp, error)
        context.res = { status: 500, body: JSON.stringify({ status: 500, timestamp, errorId, message: 'Something went wrong... Please contact customer support.' }, null, 2) }
        return
      }
    }
    context.res = {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
      body: JSON.stringify(bcMaps, null, 2)
    }
  } else if ((type === 'FactSheetUpdatedEvent') && (fsType === 'BusinessCapability') && (lastTransaction < transactionSequenceNumber)) {
    if (username !== null && password !== null) {
      const { name: providedUsername = null, pass: providedPassword = null } = auth(req) || {}
      if (providedUsername !== username || providedPassword !== password) {
        const { headers: { 'x-forwarded-for': forwardedFor } } = req
        context.res = { status: 403, body: 'invalid credentials' }
        console.error(new Date().toISOString(), '403 Forbidden', forwardedFor)
        return
      }
    }
    try {
      bcMaps = await rebuildBcMaps(transactionSequenceNumber)
      console.log(`${new Date().toISOString()} bcMaps.json updated! #${transactionSequenceNumber} (last was #${lastTransaction}) - ${type} - ${fsType}`)
      lastTransaction = transactionSequenceNumber
    } catch (error) {
      const timestamp = new Date().toISOString()
      const errorId = uuidv4()
      console.error(errorId, error)
      context.res = { status: 500, body: JSON.stringify({ status: 500, timestamp, errorId, message: 'Something went wrong... Please contact customer support.' }, null, 2) }
    }
  }
}
