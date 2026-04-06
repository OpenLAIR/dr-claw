import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { IS_PLATFORM } from '../constants/config';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}/ws`;
  }

  if (!token) {
    return null;
  }

  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const connectionIdRef = useRef(0);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { token } = useAuth();

  // Message queue: ensures every WebSocket message is delivered to consumers
  // even when multiple arrive before React can re-render.
  const messageQueueRef = useRef<any[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drainQueue = useCallback(() => {
    drainTimerRef.current = null;
    if (messageQueueRef.current.length === 0) return;
    const next = messageQueueRef.current.shift()!;
    setLatestMessage(next);
    if (messageQueueRef.current.length > 0) {
      drainTimerRef.current = setTimeout(drainQueue, 0);
    }
  }, []);

  const connect = useCallback((id?: number) => {
    if (unmountedRef.current) return;
    if (id !== undefined && id !== connectionIdRef.current) return;
    try {
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');

      const websocket = new WebSocket(wsUrl);
      const currentId = connectionIdRef.current;

      websocket.onopen = () => {
        if (currentId !== connectionIdRef.current) { websocket.close(); return; }
        setIsConnected(true);
        wsRef.current = websocket;
      };

      websocket.onmessage = (event) => {
        if (currentId !== connectionIdRef.current) return;
        try {
          const data = JSON.parse(event.data);
          messageQueueRef.current.push(data);
          if (!drainTimerRef.current) {
            drainTimerRef.current = setTimeout(drainQueue, 0);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        if (currentId !== connectionIdRef.current) return;
        setIsConnected(false);
        wsRef.current = null;

        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return;
          if (currentId !== connectionIdRef.current) return;
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token, drainQueue]);

  useEffect(() => {
    unmountedRef.current = false;
    const id = ++connectionIdRef.current;
    connect(id);

    return () => {
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (drainTimerRef.current) {
        clearTimeout(drainTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token, connect]);

  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected
  }), [sendMessage, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();
  
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
