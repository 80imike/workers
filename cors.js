/*
 * https://github.com/netnr/workers
 *
 * 2019-10-12 - 2026-05-03
 * netnr
 */

const DEFAULT_ALLOW_HEADERS = "Accept, Authorization, Cache-Control, Content-Type, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, Token, x-access-token";
const ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const DROP_REQUEST_HEADERS = [
    "host",
    "content-length",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "cf-visitor",
    "x-forwarded-proto",
    "x-real-ip"
];

export default {
    async fetch(request, env, ctx) {
        const setCorsHeaders = (headers) => {
            headers.set("Access-Control-Allow-Origin", "*");
            headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
            headers.set(
                "Access-Control-Allow-Headers",
                request.headers.get("Access-Control-Request-Headers") || DEFAULT_ALLOW_HEADERS
            );
            headers.set("Access-Control-Expose-Headers", "*");
            headers.set("Access-Control-Max-Age", "86400");
            headers.set("Vary", "Origin, Access-Control-Request-Headers");
        };

        const jsonResponse = (payload, status = 200) => {
            const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
            setCorsHeaders(headers);
            return new Response(JSON.stringify(payload), { status, headers });
        };

        if (request.method === "OPTIONS") {
            const headers = new Headers();
            setCorsHeaders(headers);
            return new Response(null, { status: 204, headers });
        }

        let targetUrl = "";
        let response;
        try {
            const current = new URL(request.url);
            const raw = request.url.slice(current.origin.length + 1);
            const decoded = decodeURIComponent(raw || "").trim();

            if (!decoded || decoded === "favicon.ico" || decoded === "robots.txt") {
                targetUrl = "";
            } else {
                if (!decoded.includes(".")) {
                    throw new Error("invalid target url");
                }

                // fix missing protocol
                targetUrl = decoded.includes("://")
                    ? decoded
                    : decoded.includes(":/")
                        ? decoded.replace(":/", "://")
                        : `http://${decoded}`;
            }

            if (!targetUrl) {
                response = jsonResponse({
                    code: 0,
                    usage: "Host/{URL}",
                    source: 'https://github.com/netnr/workers',
                    note: 'Blocking a large number of requests, please deploy it yourself'
                });
            } else {
                const headers = new Headers(request.headers);
                for (const name of DROP_REQUEST_HEADERS) {
                    headers.delete(name);
                }

                const init = {
                    method: request.method,
                    headers,
                    redirect: "follow"
                };

                if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
                    init.body = request.body;
                }

                const upstream = await fetch(targetUrl, init);
                const outHeaders = new Headers(upstream.headers);
                setCorsHeaders(outHeaders);

                response = new Response(upstream.body, {
                    status: upstream.status,
                    statusText: upstream.statusText,
                    headers: outHeaders
                });
            }
        } catch (err) {
            response = jsonResponse({
                code: -1,
                msg: err && err.message ? err.message : String(err)
            }, 500);
        }

        logStack.add(ctx, request, response, targetUrl, env.logglyCustomerToken);

        return response;
    }
};

const logStack = {
    add: (ctx, request, response, targetUrl, customerToken) => {
        if (customerToken) {
            ctx.waitUntil(fetch(`http://logs-01.loggly.com/inputs/${customerToken}/tag/http/`, {
                method: "POST",
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify(logStack.buildBody(request, response, targetUrl)),
            }));
        }
    },

    buildBody: (request, response, targetUrl) => {
        const hua = request.headers.get("user-agent")
        const hip = request.headers.get("cf-connecting-ip")
        const hrf = request.headers.get("referer")
        const url = new URL(request.url)

        const body = {
            method: request.method,
            statusCode: response.status,
            clientIp: hip,
            referer: hrf,
            userAgent: hua,
            host: url.host,
            path: url.pathname,
            proxyHost: null,
        }

        const turl = (targetUrl || "").trim();
        if (turl) {
            try {
                body.path = turl;
                body.proxyHost = new URL(turl).host;
            } catch { }
        }

        return body;
    }
};