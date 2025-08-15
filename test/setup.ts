import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock localStorage and sessionStorage with proper implementation
const createStorageMock = () => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach(key => delete store[key]);
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => {
      const keys = Object.keys(store);
      return keys[index] || null;
    }),
  };
};

Object.defineProperty(global, 'localStorage', {
  value: createStorageMock(),
  writable: true,
});

Object.defineProperty(global, 'sessionStorage', {
  value: createStorageMock(),
  writable: true,
});

// Mock browser APIs
Object.defineProperty(window, 'location', {
  value: {
    href: 'https://example.com',
    hostname: 'example.com',
    origin: 'https://example.com',
  },
  writable: true,
});

// Mock browser.runtime.sendMessage
global.browser = {
  runtime: {
    sendMessage: vi.fn(),
  },
};

// Mock webextension-polyfill
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: vi.fn(),
    },
  },
}));

// Mock @wxt-dev/storage
vi.mock('@wxt-dev/storage', () => ({
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

// Polyfill for Element.prototype.getAttributeNames
if (typeof Element !== 'undefined' && Element.prototype && typeof Element.prototype.getAttributeNames === 'undefined') {
  console.log('Polyfilling Element.prototype.getAttributeNames');
  Element.prototype.getAttributeNames = function getAttributeNames() {
    const attributes = this.attributes;
    const result = [];
    for (let i = 0; i < attributes.length; i++) {
      result.push(attributes[i].name);
    }
    return result;
  };
} else if (typeof Element !== 'undefined') {
  console.log('Element.prototype.getAttributeNames already exists.');
} else {
  console.log('Element is not defined.');
}