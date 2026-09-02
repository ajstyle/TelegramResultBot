const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { TOTP } = require('otpauth');

/**
 * Zerodha Kite Headless Auto-Login Service
 * Bypasses manual browser login by automatically fetching a daily access token using credentials and TOTP.
 */
class KiteAutoLoginService {
  /**
   * Update the .env file with the newly generated access token
   */
  updateEnvFile(newToken) {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;

    let envContents = fs.readFileSync(envPath, 'utf8');
    const tokenRegex = /^KITE_ACCESS_TOKEN=.*$/m;

    if (tokenRegex.test(envContents)) {
      envContents = envContents.replace(tokenRegex, `KITE_ACCESS_TOKEN=${newToken}`);
    } else {
      envContents += `\nKITE_ACCESS_TOKEN=${newToken}\n`;
    }

    fs.writeFileSync(envPath, envContents);
    config.kite.accessToken = newToken; // Update active memory config instantly
    console.log('[KiteAutoLogin] ✅ .env file updated with fresh Kite Access Token.');
  }

  /**
   * Run the completely automated login flow
   */
  async generateDailyToken() {
    const { userId, password, totpSecret, apiKey, apiSecret } = config.kite;

    if (!userId || !password || !totpSecret || !apiKey || !apiSecret) {
      console.error('[KiteAutoLogin] 🛑 Missing Kite Auto-Login Credentials in .env (Requires: KITE_USER_ID, KITE_PASSWORD, KITE_TOTP_SECRET, KITE_API_KEY, KITE_API_SECRET)');
      return null;
    }

    try {
      console.log(`[KiteAutoLogin] 🔄 Starting automated background login for Zerodha User: ${userId}...`);

      // STEP 1: Primary Login (Username/Password)
      const loginPayload = new URLSearchParams();
      loginPayload.append('user_id', userId);
      loginPayload.append('password', password);

      const loginRes = await axios.post('https://kite.zerodha.com/api/login', loginPayload.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      if (loginRes.data.status !== 'success') {
        throw new Error(`Primary login failed: ${loginRes.data.message || 'Unknown Error'}`);
      }
      
      const requestId = loginRes.data.data.request_id;
      console.log(`[KiteAutoLogin] ✅ Primary auth successful. Request ID: ${requestId}`);

      // STEP 2: TOTP Generation & Two-Factor Auth Validation
      const totp = new TOTP({
        issuer: 'Zerodha',
        label: userId,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: totpSecret.replace(/\s+/g, '') // Clean spaces just in case
      });
      
      const twoFaCode = totp.generate();
      console.log(`[KiteAutoLogin] 🔐 Generated Mathematical TOTP Code: ${twoFaCode}`);

      const twoFaPayload = new URLSearchParams();
      twoFaPayload.append('user_id', userId);
      twoFaPayload.append('request_id', requestId);
      twoFaPayload.append('twofa_value', twoFaCode);
      twoFaPayload.append('twofa_type', 'totp');

      const twoFaRes = await axios.post('https://kite.zerodha.com/api/twofa', twoFaPayload.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      if (twoFaRes.data.status !== 'success') {
        throw new Error(`2FA login failed: ${twoFaRes.data.message || 'Unknown Error'}`);
      }

      // Extract the authenticated kf_session cookie
      const cookies = twoFaRes.headers['set-cookie'] || [];
      const kfSessionCookie = cookies.find(c => c.startsWith('kf_session='));
      
      if (!kfSessionCookie) {
        throw new Error('Critical Error: Failed to retrieve kf_session cookie after 2FA validation.');
      }
      console.log(`[KiteAutoLogin] ✅ 2FA successful. Session Cookie extracted.`);

      // STEP 3: Request Token via Kite Connect Authorization Redirect
      const authUrl = `https://kite.trade/connect/login?api_key=${apiKey}&v=3`;
      let redirectUrl = null;

      try {
        await axios.get(authUrl, {
          headers: { Cookie: kfSessionCookie },
          maxRedirects: 0 // Prevent axios from following the redirect so we can scrape the request_token from the URL!
        });
      } catch (redirectError) {
        if (redirectError.response && redirectError.response.status === 302) {
          redirectUrl = redirectError.response.headers.location;
        } else {
          throw redirectError;
        }
      }

      if (!redirectUrl || !redirectUrl.includes('request_token=')) {
        throw new Error('Failed to capture request_token redirect from Kite Connect. Is your API Key correct?');
      }

      const requestToken = new URL(redirectUrl).searchParams.get('request_token');
      console.log(`[KiteAutoLogin] ✅ Extracted Request Token: ${requestToken}`);

      // STEP 4: Exchange Request Token for Final 24h Access Token
      const crypto = require('crypto');
      const hashData = `${apiKey}${requestToken}${apiSecret}`;
      const checksum = crypto.createHash('sha256').update(hashData).digest('hex');

      const tokenPayload = new URLSearchParams();
      tokenPayload.append('api_key', apiKey);
      tokenPayload.append('request_token', requestToken);
      tokenPayload.append('checksum', checksum);

      const tokenRes = await axios.post('https://api.kite.trade/session/token', tokenPayload.toString(), {
        headers: {
          'X-Kite-Version': '3',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (tokenRes.data.status === 'success' && tokenRes.data.data.access_token) {
        const finalAccessToken = tokenRes.data.data.access_token;
        console.log(`[KiteAutoLogin] 🎉 Success! Final 24-hour Access Token generated.`);
        
        // Save to .env and memory
        this.updateEnvFile(finalAccessToken);
        return finalAccessToken;
      } else {
        throw new Error(`Token exchange failed: ${tokenRes.data.message || JSON.stringify(tokenRes.data)}`);
      }
    } catch (err) {
      console.error(`[KiteAutoLogin] 🛑 Auto-Login Failed: ${err.message}`);
      return null;
    }
  }
}

module.exports = new KiteAutoLoginService();
