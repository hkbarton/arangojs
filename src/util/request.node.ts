import {
  ClientRequest,
  Agent as HttpAgent,
  IncomingMessage,
  request as httpRequest
} from "http";
import { Agent as HttpsAgent, request as httpsRequest } from "https";
import { Url, parse as parseUrl } from "url";

import { Errback } from "./types";
import { joinPath } from "./joinPath";

export type ArangojsResponse = IncomingMessage & {
  body?: any;
  host?: number;
};

export type ArangojsError = Error & {
  request: ClientRequest;
  code: string;
};

export type RequestOptions = {
  method: string;
  url: Url;
  headers: { [key: string]: string };
  body: any;
  expectBinary: boolean;
};

export type RequestFunction = (
  opts: RequestOptions,
  cb: Errback<ArangojsResponse>
) => void;

export const isBrowser = false;

export function createRequest(
  baseUrl: string,
  agentOptions: any,
  agent: any
): RequestFunction {
  const baseUrlParts = parseUrl(baseUrl);
  const isTls = baseUrlParts.protocol === "https:";
  if (!agent) {
    if (isTls) agent = new HttpsAgent(agentOptions);
    else agent = new HttpAgent(agentOptions);
  }
  return function request(
    { method, url, headers, body }: RequestOptions,
    callback: Errback<ArangojsResponse>
  ) {
    let path = baseUrlParts.pathname
      ? url.pathname
        ? joinPath(baseUrlParts.pathname, url.pathname)
        : baseUrlParts.pathname
      : url.pathname;
    const search = url.search
      ? baseUrlParts.search
        ? `${baseUrlParts.search}&${url.search.slice(1)}`
        : url.search
      : baseUrlParts.search;
    if (search) path += search;
    const options: any = { path, method, headers, agent };
    options.hostname = baseUrlParts.hostname;
    options.port = baseUrlParts.port;
    options.auth = baseUrlParts.auth;
    let called = false;
    let timerForTimeout = -1;
    const req = (isTls ? httpsRequest : httpRequest)(
      options,
      (res: IncomingMessage) => {
        const data: Buffer[] = [];
        res.on("data", chunk => data.push(chunk as Buffer));
        res.on("end", () => {
          clearTimeout(timerForTimeout);
          const result = res as ArangojsResponse;
          result.body = Buffer.concat(data);
          if (called) return;
          called = true;
          callback(null, result);
        });
      }
    );

    if (agentOptions.timeout) {
      timerForTimeout = setTimeout(() => {
        timerForTimeout = -1;
        req.abort();
        const err = new Error("Arango Query Timeout") as ArangojsError;
        err.code = "ARANGO_QUERY_TIMEOUT";
        callback(err);
      }, agentOptions.timeout);
    }

    req.on("error", err => {
      clearTimeout(timerForTimeout);
      const error = err as ArangojsError;
      error.request = req;
      if (called) return;
      called = true;
      callback(err);
    });
    if (body) req.write(body);
    req.end();
  };
}
