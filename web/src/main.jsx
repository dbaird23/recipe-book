import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import './index.css';

// The service worker keeps the shell on the phone, so the app opens with no
// signal. A newer build is fetched behind the page at open and, once it's
// ready, the page reloads onto it: moments after opening, not mid-cook.
registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(<App />);
