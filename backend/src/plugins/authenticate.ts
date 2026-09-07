// Registers JWT and an `authenticate` guard usable as a route preHandler.
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { env } from "../lib/env.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

export default fp(async (app) => {
  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    // Tokens expire. Without this a leaked token is valid forever — there is
    // no server-side session to revoke. 30 days balances "students shouldn't
    // re-login weekly" against bounding the damage of a stolen token; the
    // frontend already treats any 401 as a sign-out.
    sign: { expiresIn: `${env.JWT_TTL_DAYS}d` },
  });

  app.decorate(
    "authenticate",
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch {
        reply.code(401).send({ error: "Unauthorized" });
      }
    }
  );
});
