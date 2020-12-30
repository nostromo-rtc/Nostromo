import UI from './UI.js';
import SocketHandler from './SocketHandler.js';
// создаем обработчик интерфейса и обработчик сокетов
const UIinstance = new UI();
const SocketHandlerInstance = new SocketHandler(UIinstance);