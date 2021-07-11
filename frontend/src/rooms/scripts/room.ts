import UI from './UI.js';
import SocketHandler from './SocketHandler.js';
import { Mediasoup } from './Mediasoup.js';

const ui = new UI();                                    // создаем обработчик интерфейса
const mediasoup = new Mediasoup();                      // обработчик mediasoup-client
const socketHandler = new SocketHandler(ui, mediasoup); // обработчик сокетов