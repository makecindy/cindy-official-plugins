'use strict';

// A failed lookup is not evidence that an app is absent. Share the exact
// simctl missing-file diagnostic across installation and log-scope queries.
async function appContainer({sim, Failure}, device, bundleId, options) {
  let result;
  try { result = await sim(['get_app_container', device.udid, bundleId, 'app'], options); }
  catch (error) {
    if (error.code === 'COMMAND_FAILED' && /domain=NSPOSIXErrorDomain,\s*code=2\)/.test(error.message) && /No such file or directory/.test(error.message)) return null;
    throw error;
  }
  if (!result.stdout) throw new Failure('APP_LOOKUP_FAILED', 'The simulator returned no App container path. Check the device connection before continuing.');
  return result.stdout;
}

module.exports = {appContainer};
