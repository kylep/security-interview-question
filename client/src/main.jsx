import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/insecure-sw.js').catch(err => {
    console.warn('Service worker registration failed', err);
  });
}
