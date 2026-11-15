(() => {
    let socket;
    let stopped = false;
    const listeners = new Set();
    let current = null;
    function connect() {
        if (stopped) return;
        const url = new URL('_socket', location.href);
        url.protocol = 'ws:';
        socket = new WebSocket(url);
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.type !== 'state') return;
            current = message.state;
            for (const listener of listeners) listener(current);
        };
        socket.onclose = () => {
            current = null;
            for (const listener of listeners) listener(current);
            if (!stopped) setTimeout(connect, 1000);
        };
    }
    window.opensdWidget = Object.freeze({
        get state() { return current; },
        subscribe(listener) {
            listeners.add(listener);
            listener(current);
            return () => listeners.delete(listener);
        },
        send(payload) {
            if (socket?.readyState !== WebSocket.OPEN) throw new Error('Widget is disconnected');
            socket.send(JSON.stringify(payload));
        },
    });
    addEventListener('pagehide', () => { stopped = true; socket?.close(); });
    connect();
})();
