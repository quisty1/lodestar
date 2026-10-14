import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

// The SFC default export is checked by vue-tsc. ESLint's project service types it as an error.
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
createApp(App).mount('#app');
