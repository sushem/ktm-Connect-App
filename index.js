/**
 * @format
 */

// Must come first: the dashboard handshake needs a real random source, and
// Hermes has no crypto.getRandomValues of its own.
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
