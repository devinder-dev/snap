import type { FastifyInstance } from "fastify";
import * as controllers from './controllers'

async function routes(httpServer: FastifyInstance) {

    // At most 20 new accounts per client IP a minute: room for a few typos and
    // the e2e's seven, not for a script creating thousands.
    httpServer.route({
        method: 'POST',
        url: '/register',
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        handler: controllers.register
    })

    // At most 5 tries a minute for one account from one IP — counted per
    // account, so a typo on yours doesn't block someone else on the same
    // Wi-Fi. Enough for a person, far too slow for guessing passwords.
    httpServer.route({
        method: 'POST',
        url: '/login',
        config: {
            rateLimit: {
                max: 5,
                timeWindow: '1 minute',
                keyGenerator: (request) => {
                    const username = (request.body as { username?: unknown } | undefined)?.username
                    return `${request.ip}|${typeof username === 'string' ? username : ''}`
                },
            },
        },
        handler: controllers.login
    })

    // Unauthenticated on purpose: the access token you'd authenticate with is
    // the thing that has expired. The refresh token in the body is the credential.
    httpServer.route({
        method: 'POST',
        url: '/refresh',
        handler: controllers.refresh
    })

    httpServer.route({
        method: 'GET',
        url: '/friends',
        preHandler: [httpServer.authenticate],
        handler: controllers.getFriends
    })

    // Static path, so it never collides with /friends/:username below.
    httpServer.route({
        method: 'GET',
        url: '/friends/requests',
        preHandler: [httpServer.authenticate],
        handler: controllers.getFriendRequests
    })

    httpServer.route({
        method: 'POST',
        url: '/friends',
        preHandler: [httpServer.authenticate],
        handler: controllers.addFriend
    })

    httpServer.route({
        method: 'DELETE',
        url: '/friends/:username',
        preHandler: [httpServer.authenticate],
        handler: controllers.deleteFriend
    })

    httpServer.route({
        method: 'POST',
        url: '/snaps',
        preHandler: [httpServer.authenticate],
        handler: controllers.sendSnap
    })

    httpServer.route({
        method: 'GET',
        url: '/snaps',
        preHandler: [httpServer.authenticate],
        handler: controllers.getInbox
    })

    // Destructive: this is the one and only read of a given snap.
    httpServer.route({
        method: 'GET',
        url: '/snaps/:id',
        preHandler: [httpServer.authenticate],
        handler: controllers.getSnap
    })

    httpServer.route({
        method: 'POST',
        url: '/snaps/:id/screenshot',
        preHandler: [httpServer.authenticate],
        handler: controllers.reportScreenshot
    })

    // Chat. Writes go over HTTP like everything else; the socket only pushes
    // `message_received` afterwards.
    httpServer.route({
        method: 'GET',
        url: '/conversations',
        preHandler: [httpServer.authenticate],
        handler: controllers.getConversations
    })

    httpServer.route({
        method: 'GET',
        url: '/messages/:username',
        preHandler: [httpServer.authenticate],
        handler: controllers.getMessages
    })

    httpServer.route({
        method: 'POST',
        url: '/messages/:username',
        preHandler: [httpServer.authenticate],
        handler: controllers.sendMessage
    })

}

export default routes
