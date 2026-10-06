import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { Unauthorized } from './errors';

export interface TokenPayload {
  username: string;
  type: 'access' | 'refresh';
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

// @fastify/jwt already declares `user` on FastifyRequest, so augmenting it
// again clashes on the optional modifier. FastifyJWT is the extension point
// it provides instead: `payload` types what you sign, `user` what you get
// back from jwtVerify() and request.user.
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

const secretKey = process.env.JWT_SECRET_KEY;

if (secretKey === undefined) throw new Error('Set JWT_SECRET_KEY!');

async function auth(
  server: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  await server.register(fastifyJwt, {
    secret: secretKey!!,
    sign: {
      expiresIn: 10000,
    },
  });

  server.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      let decodedToken: TokenPayload;

      try {
        // jwtVerify() is generic over its return type (it doesn't read the
        // FastifyJWT augmentation), so it keeps the explicit TokenPayload.
        // It also assigns request.user itself (index.js:547) — nothing to copy.
        decodedToken = await request.jwtVerify<TokenPayload>();
      } catch {
        // Missing, expired or forged. Thrown rather than sent so it goes through
        // the global error handler and has the same JSON shape as every other
        // error — a plain-text body here left the client unable to read it.
        throw new Unauthorized('You are not authorized');
      }

      // A refresh token is signed with the same secret; it must not work here.
      if (decodedToken.type !== 'access') throw new Unauthorized('You are not authorized');
    }
  );
}

export default fastifyPlugin(auth);
