const axios = require('axios');
const fs = require('fs');
const { dateToUnixTimestamp } = require('./util.js');
const { addLog } = require('./logger.js');

const client_id = process.env.RB_CLIENT_ID;
const client_secret = process.env.RB_CLIENT_SECRET;
const redirect_uri = process.env.RB_REDIRECT_URI;

const fetchAccessToken = async (refreshToken = null, code = null) => {
    addLog(refreshToken ? 'Refreshing Redbooth access token.' : 'Fetching Redbooth access token with authorization code.');
    var accessToken = null;
    var error = null;
    var params = {
        client_id,
        client_secret
    }
    if (refreshToken) {
        params.refresh_token = refreshToken;
        params.grant_type = 'refresh_token';
    } else {
        params.code = code;
        params.redirect_uri = redirect_uri;
        params.grant_type = 'authorization_code';
    }
    await axios.post('https://redbooth.com/oauth2/token', params).then((response) => {
        accessToken = response.data;
        addLog('Redbooth access token received.');
        try {
            fs.writeFileSync('./rb_token.json', JSON.stringify(accessToken));
            addLog('Redbooth token saved to rb_token.json.');
        } catch (err) {
            addLog('Failed to save Redbooth token: ' + err.message);
        }
    }).catch((err) => {
        if (err.response) {
            error = {};
            error.status = err.response.status;
            error.statusText = err.response.statusText;
            error.message = err.message;
            error.error = err.response.data.error;
            error.error_description = err.response.data.error_description;
            addLog(`Redbooth token request failed: ${error.status} ${error.statusText} - ${error.message}.`);
        } else {
            addLog('Redbooth token request failed: ' + err.message);
        }
    });
    return accessToken != null ? accessToken : error;
}

const getAccessToken = async () => {
    addLog('Loading Redbooth access token from rb_token.json.');
    let accessToken = JSON.parse(fs.readFileSync('./rb_token.json'));
    let currentTimestamp = dateToUnixTimestamp(new Date());
    if ((currentTimestamp - accessToken.created_at) > 7200) {
        addLog('Redbooth access token expired.');
        return await fetchAccessToken(accessToken.refresh_token);
    } else {
        addLog('Using existing Redbooth access token.');
        return accessToken;
    }
}

module.exports = {
    fetchAccessToken,
    getAccessToken
}
