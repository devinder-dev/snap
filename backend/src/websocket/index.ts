import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import type { TokenPayload } from "../auth";
import { Unauthorized } from "../errors";
import { setWebsocketServer, userRoom, type SnapSocketServer } from "./server";
import type {
    ClientToServerEvents,
    InterServerEvents,
    ServerToClientEvents,
    SocketData,
} from "./types";

async function websocket(httpServer: FastifyInstance) {
    const websocketServer: SnapSocketServer = new Server<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
    >(httpServer.server, {});

    setWebsocketServer(websocketServer);

    console.log("Websocket initialized!");

    // Identity comes from the JWT and nowhere else. If the server trusted a
    // username out of an event payload, any client could claim to be anyone.
    //
    // This runs once, at the handshake — an access token that expires later
    // does not drop an already-open socket.
    websocketServer.use((socket, next) => {
        try {
            const payload = httpServer.jwt.verify<TokenPayload>(
                socket.handshake.auth.token,
            );

            if (payload.type !== "access") {
                throw new Unauthorized("Invalid token type");
            }

            socket.data.username = payload.username;
        } catch {
            // next() is called exactly once on this path. Calling it inside the
            // try as well would let a throw from next() itself run it twice.
            return next(new Unauthorized("You are not authorized"));
        }

        next();
    });

    // När en användare har anslutit.
    websocketServer.on("connection", (socket) => {
        // The personal room is how services address this person by name without
        // tracking socket ids. Several devices join the same room; socket.io
        // removes each socket from it on disconnect.
        socket.join(userRoom(socket.data.username));

        console.log(`Websocket connected: ${socket.data.username}`);

        // No inbound event handlers: the socket is push-only and every write
        // goes over HTTP.

        socket.on("disconnect", (reason) => {
            console.log(
                `Websocket disconnected: ${socket.data.username} (${reason})`,
            );
        });
    });

    httpServer.addHook("preClose", (done) => {
        // close all active connections on this server
        websocketServer.local.disconnectSockets(true);
        done();
    });
}

export default websocket
