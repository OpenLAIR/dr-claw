import jwt from 'jsonwebtoken';
import { userDb } from '../database/db.js';
import { IS_PLATFORM } from '../constants/config.js';
import { resolveJwtSecret } from '../utils/jwtSecret.js';

// Resolve the JWT signing secret: JWT_SECRET, else JWT_SECRET_FILE, else a
// random secret generated once and stored next to the database. There is no
// static fallback (see GitHub issue #225).
const JWT_SECRET = resolveJwtSecret();

// Token lifetime (default: 30 days). Set JWT_EXPIRY to override, e.g. "24h", "30d".
const JWT_EXPIRY = process.env.JWT_EXPIRY || '30d';
// Validate JWT_EXPIRY at startup to fail fast on misconfiguration
try {
  jwt.sign({ _validate: true }, 'test', { expiresIn: JWT_EXPIRY });
} catch {
  throw new Error(
    `Invalid JWT_EXPIRY value: "${JWT_EXPIRY}". `
    + 'Use formats like "1h", "7d", "30d", or a number of seconds.'
  );
}

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    if (IS_PLATFORM) {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(401).json({ error: 'No authenticated user found' });
      }
      req.user = user;
      return next();
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Generate JWT token with configurable expiry (default: 7 days)
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (token) => {
  try {
    if (IS_PLATFORM) {
      const user = userDb.getFirstUser();
      return user ? { userId: user.id, username: user.username } : null;
    }

    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return null;
    }

    return { userId: user.id, username: user.username };
  } catch (error) {
    console.error('WebSocket auth error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET
};
