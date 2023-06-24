const axios = require('axios');
const fs = require('fs');
const { dateToUnixTimestamp } = require('./util.js');

const client_id = process.env.RB_CLIENT_ID;
const client_secret = process.env.RB_CLIENT_SECRET;
const redirect_uri = process.env.RB_REDIRECT_URI;

const fetchAccessToken = async (refreshToken = null, code = null) => {
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
        console.log('Access Token returned from response: ', accessToken);
        try {
            fs.writeFileSync('./rb_token.json', JSON.stringify(accessToken));
        } catch (err) {
            console.error(err);
        }
    }).catch((err) => {
        if (err.response) {
            error = {};
            console.log(err.response.status);
            error.status = err.response.status;
            console.log(err.response.statusText);
            error.statusText = err.response.statusText;
            console.log(err.message);
            error.message = err.message;
            console.log(err.response.headers); // 👉️ {... response headers here}
            console.log(err.response.data); // 👉️ {... response data here}
            error.error = err.response.data.error;
            error.error_description = err.response.data.error_description;
        }
    });
    return accessToken != null ? accessToken : error;
}

const getAccessToken = async () => {
    let accessToken = JSON.parse(fs.readFileSync('./rb_token.json'));
    let currentTimestamp = dateToUnixTimestamp(new Date());
    if ((currentTimestamp - accessToken.created_at) > 7200) {
        console.log('Access token is expired!');
        return await fetchAccessToken(accessToken.refresh_token);
    } else {
        return accessToken;
    }
}

module.exports = {
    fetchAccessToken,
    getAccessToken
}