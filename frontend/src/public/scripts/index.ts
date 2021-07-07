import indexSocketHandler from './indexSocketHandler.js';
import authSocketHandler from './authSocketHandler.js';

// создаем обработчики интерфейса и обработчики сокетов

if (window.location.pathname.search('rooms') == -1)
{
    const indexSocketHandlerInstance = new indexSocketHandler();
}
else
{
    const authSocketHandlerInstance = new authSocketHandler();
}