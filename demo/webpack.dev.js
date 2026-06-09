/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('path');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const { stylePaths } = require('./stylePaths');
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || '9000';
const repoRoot = path.resolve(__dirname, '..');

module.exports = merge(common('development'), {
  mode: 'development',
  devtool: 'eval-source-map',
  devServer: {
    host: HOST,
    port: PORT,
    historyApiFallback: true,
    open: true,
    static: {
      directory: path.resolve(__dirname, 'dist'),
    },
    client: {
      overlay: true,
    },
    setupMiddlewares: (middlewares, devServer) => {
      if (!devServer || !devServer.app) {
        return middlewares;
      }

      // Load env vars for local OAuth/token exchange without bundling secrets into the client.
      // `.env` is for client-safe values (e.g. VITE_GITHUB_CLIENT_ID, owner/repo).
      // `.env.server` is for server-only secrets (e.g. GITHUB_CLIENT_SECRET).
      try {
        // eslint-disable-next-line global-require
        const dotenv = require('dotenv');
        const envResult = dotenv.config({ path: path.resolve(repoRoot, '.env') });
        // IMPORTANT: allow server-only secrets to override anything accidentally present in `.env` or the shell env.
        const envServerResult = dotenv.config({ path: path.resolve(repoRoot, '.env.server'), override: true });
        if (envServerResult.error && envServerResult.error.code !== 'ENOENT') {
          // eslint-disable-next-line no-console
          console.warn('[Commenting System] Warning loading .env.server:', envServerResult.error.message);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Commenting System] Warning loading environment files:', e.message);
      }

      // eslint-disable-next-line global-require
      const express = require('express');
      devServer.app.use(express.json());

      devServer.app.get('/api/github-oauth-callback', async (req, res) => {
        try {
          const code = req.query.code;
          if (!code) {
            return res.status(400).send('Missing ?code from GitHub OAuth callback.');
          }

          const clientId = process.env.VITE_GITHUB_CLIENT_ID;
          const clientSecret = process.env.GITHUB_CLIENT_SECRET;

          if (!clientId) {
            return res.status(500).send('Missing VITE_GITHUB_CLIENT_ID (client id).');
          }
          if (!clientSecret) {
            return res.status(500).send(
              'Missing GITHUB_CLIENT_SECRET. For local dev, put it in .env.server (gitignored).'
            );
          }

          // Exchange code -> access token
          const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              code,
            }),
          });

          const tokenData = await tokenResp.json();
          if (!tokenResp.ok || tokenData.error) {
            return res
              .status(500)
              .send(`OAuth token exchange failed: ${tokenData.error || tokenResp.statusText}`);
          }

          const accessToken = tokenData.access_token;
          if (!accessToken) {
            return res.status(500).send('OAuth token exchange did not return an access_token.');
          }

          // Fetch user
          const userResp = await fetch('https://api.github.com/user', {
            headers: {
              'Accept': 'application/vnd.github+json',
              'Authorization': `token ${accessToken}`,
              'User-Agent': 'design-comments',
            },
          });
          const user = await userResp.json();
          if (!userResp.ok) {
            return res.status(500).send(`Failed to fetch GitHub user: ${user.message || userResp.statusText}`);
          }

          const login = encodeURIComponent(user.login || '');
          const avatar = encodeURIComponent(user.avatar_url || '');
          const token = encodeURIComponent(accessToken);

          // Redirect back into the SPA; GitHubAuthContext will read these and store them.
          return res.redirect(`/#/auth-callback?token=${token}&login=${login}&avatar=${avatar}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(err);
          return res.status(500).send('Unhandled OAuth callback error. See dev server logs.');
        }
      });

      devServer.app.post('/api/github-api', async (req, res) => {
        try {
          const { token, method, endpoint, data } = req.body || {};
          if (!token) return res.status(401).json({ message: 'Missing token' });
          if (!method || !endpoint) return res.status(400).json({ message: 'Missing method or endpoint' });

          const url = `https://api.github.com${endpoint}`;
          const resp = await fetch(url, {
            method,
            headers: {
              'Accept': 'application/vnd.github+json',
              'Authorization': `token ${token}`,
              'User-Agent': 'design-comments',
              ...(data ? { 'Content-Type': 'application/json' } : {}),
            },
            body: data ? JSON.stringify(data) : undefined,
          });

          const text = await resp.text();
          const maybeJson = (() => {
            try {
              return JSON.parse(text);
            } catch {
              return text;
            }
          })();

          return res.status(resp.status).json(maybeJson);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(err);
          return res.status(500).json({ message: 'Unhandled github-api proxy error. See dev server logs.' });
        }
      });

      devServer.app.get('/api/jira-issue', async (req, res) => {
        try {
          const key = String(req.query.key || '').trim();
          if (!key) return res.status(400).json({ message: 'Missing ?key (e.g. ABC-123)' });

          const baseUrl = (process.env.VITE_JIRA_BASE_URL || 'https://issues.redhat.com').replace(/\/+$/, '');
          const email = (process.env.JIRA_EMAIL || '').trim();
          const token = (process.env.JIRA_API_TOKEN || '').trim();

          if (!token) {
            // eslint-disable-next-line no-console
            console.error('[Commenting System] JIRA_API_TOKEN is missing or empty. Check .env.server file.');
            return res.status(500).json({
              message:
                'Missing JIRA_API_TOKEN. For local dev, put it in .env.server (gitignored). Make sure the dev server was restarted after creating/updating .env.server.',
            });
          }

          const authHeader = email
            ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` // Jira Cloud API token style
            : `Bearer ${token}`; // Jira Server/DC PAT style

          const adfToText = (node) => {
            if (!node) return '';
            if (typeof node === 'string') return node;
            if (Array.isArray(node)) return node.map(adfToText).join('');
            if (typeof node !== 'object') return '';
            if (typeof node.text === 'string') return node.text;
            const content = Array.isArray(node.content) ? node.content : [];
            // Join blocks with newlines to preserve basic readability.
            const joined = content.map(adfToText).join(node.type === 'paragraph' ? '' : '\n');
            return joined;
          };

          const stripHtmlTags = (input) => {
            if (!input) return '';
            return String(input)
              .replace(/<[^>]*>/g, '')
              .replace(/\r\n/g, '\n')
              .trim();
          };

          const buildUrl = (apiVersion) =>
            `${baseUrl}/rest/api/${apiVersion}/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,issuetype,priority,created,updated,description&expand=renderedFields`;

          const commonHeaders = {
            'Accept': 'application/json',
            'Authorization': authHeader,
            'User-Agent': 'design-comments',
          };

          const fetchOnce = async (apiVersion) => {
            const r = await fetch(buildUrl(apiVersion), { headers: commonHeaders, redirect: 'manual' });
            const text = await r.text();
            const contentType = String(r.headers.get('content-type') || '');
            const looksLikeHtml =
              contentType.includes('text/html') ||
              String(text || '').trim().startsWith('<');
            return { r, text, contentType, looksLikeHtml };
          };

          // Red Hat Jira (issues.redhat.com) commonly works reliably on REST API v2.
          // More generally: fall back across versions when we detect SSO redirects (302),
          // HTML payloads, or auth failures that might be version-specific.
          const preferV2 = baseUrl.includes('issues.redhat.com');
          const firstVersion = preferV2 ? '2' : '3';
          const secondVersion = preferV2 ? '3' : '2';

          let attempt = await fetchOnce(firstVersion);
          if (
            attempt.r.status === 404 ||
            attempt.r.status === 302 ||
            attempt.looksLikeHtml ||
            attempt.r.status === 401 ||
            attempt.r.status === 403
          ) {
            const fallback = await fetchOnce(secondVersion);
            // Prefer the fallback if it succeeded, or if the first attempt clearly looked like SSO/HTML.
            if (fallback.r.ok || attempt.looksLikeHtml || attempt.r.status === 302) {
              attempt = fallback;
            }
          }

          const resp = attempt.r;
          const payloadText = attempt.text;
          const contentType = attempt.contentType;

          const payload = (() => {
            try {
              return JSON.parse(payloadText);
            } catch {
              return { message: payloadText };
            }
          })();

          if (!resp.ok) {
            // Many SSO flows return HTML (login page) instead of JSON; never dump that into the UI.
            const looksLikeHtml =
              contentType.includes('text/html') ||
              String(payloadText || '').trim().startsWith('<');

            if (looksLikeHtml) {
              return res.status(resp.status).json({
                message:
                  resp.status === 401 || resp.status === 403
                    ? 'Unauthorized to Jira. Your token/auth scheme may be incorrect for this Jira instance.'
                    : `Jira request failed (${resp.status}).`,
                hint: email
                  ? 'You are using Basic auth (JIRA_EMAIL + JIRA_API_TOKEN). If this Jira uses PAT/Bearer tokens, remove JIRA_EMAIL and set only JIRA_API_TOKEN.'
                  : baseUrl.includes('issues.redhat.com')
                    ? 'You are using Bearer auth (JIRA_API_TOKEN). For issues.redhat.com, ensure you are using a PAT that works with REST API v2 and that JIRA_EMAIL is NOT set.'
                    : 'You are using Bearer auth (JIRA_API_TOKEN). If this Jira uses Jira Cloud API tokens, set JIRA_EMAIL as well.',
              });
            }

            return res.status(resp.status).json({
              message: payload?.message || `Jira request failed (${resp.status}).`,
            });
          }

          const issue = payload;
          const fields = issue.fields || {};

          const descriptionRaw = fields.description;
          const descriptionText =
            typeof descriptionRaw === 'string'
              ? descriptionRaw
              : typeof descriptionRaw === 'object'
                ? adfToText(descriptionRaw)
                : '';

          const renderedDescription = issue?.renderedFields?.description;
          const renderedDescriptionText = stripHtmlTags(renderedDescription || '');

          const finalDescription =
            (stripHtmlTags(descriptionText) || renderedDescriptionText || '').trim();

          return res.json({
            key: issue.key,
            url: `${baseUrl}/browse/${issue.key}`,
            summary: fields.summary || '',
            status: fields.status?.name || '',
            assignee: fields.assignee?.displayName || '',
            issueType: fields.issuetype?.name || '',
            priority: fields.priority?.name || '',
            created: fields.created || '',
            updated: fields.updated || '',
            description: finalDescription || '',
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(err);
          return res.status(500).json({ message: 'Unhandled jira-issue proxy error. See dev server logs.' });
        }
      });

      // Optional: AI summaries (OpenAI-compatible chat completions). Set MAAS_API_KEY + MAAS_ENDPOINT_URL in .env / .env.server.
      devServer.app.post('/api/discussions-summarize', async (req, res) => {
        try {
          const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
          if (!prompt.trim()) {
            return res.status(400).json({ error: 'Missing or empty prompt' });
          }
          const apiKey = process.env.MAAS_API_KEY;
          const baseUrl = (process.env.MAAS_ENDPOINT_URL || '').trim().replace(/\/+$/, '');
          const completionsPath = '/v1/chat/completions';
          const model = process.env.MAAS_MODEL || 'gpt-4o-mini';
          if (!apiKey || !baseUrl) {
            return res.status(200).json({
              summary:
                'Summarization is not configured. Set MAAS_API_KEY and MAAS_ENDPOINT_URL in .env or .env.server (e.g. https://api.openai.com). See README.',
            });
          }
          const endpointUrl = `${baseUrl}${completionsPath}`;
          const body = JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 400,
            temperature: 0.3,
          });
          const resp = await fetch(endpointUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body,
          });
          const data = await resp.json().catch(() => ({}));
          const summaryText =
            data.choices?.[0]?.message?.content ??
            data.choices?.[0]?.text ??
            data.output?.[0] ??
            '';
          if (resp.ok) {
            return res.status(200).json({ summary: String(summaryText).trim() });
          }
          return res.status(resp.status).json({
            error: data.error?.message || resp.statusText || 'Summarization request failed',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Summarization proxy error';
          return res.status(500).json({ error: message });
        }
      });

      return middlewares;
    },
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        include: [...stylePaths],
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
});
