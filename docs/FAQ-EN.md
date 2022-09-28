# FAQ

- [Are there any releases for quick deploy?](#are-there-any-releases-for-quick-deploy)
- [Is there any guide for quick setup?](#is-there-any-guide-for-quick-setup)
- [Instead of the video, a black screen is transmitted, and then an error pops up, what should I do?](#instead-of-the-video-a-black-screen-is-transmitted-and-then-an-error-pops-up-what-should-i-do)

### Are there any releases for quick deploy?

Yes, in the [release section](https://gitlab.com/SgAkErRu/nostromo/-/releases).

### Is there any guide for quick setup?

Yes, there is [guide for quick setup](SETUP-EN.md#guide-for-quick-setup).

### Instead of the video, a black screen is transmitted, and then an error pops up, what should I do?

If you have a black screen instead of a video, and after a short time an error pops up suggesting checking the proxy settings, and the console logs show the error `ICE failed`, then this means that **WebRTC**-connection to the media server failed.

This can happen for two reasons:
1. It is not possible to connect due to the fault of the client.
2. It is not possible to connect due to the fault of the server.

In the first case, you need to make sure that the client can connect to your server to the specified media ports (which you specified in the configuration file) using the protocol that you specified (TCP or UDP). Check all the options that may interfere with the connection: proxy settings, firewall, router, and so on.

In the second case, you need to make sure that the media ports are open from the server side and clients can freely connect to them. The solution is exactly the same: check the settings of the firewall, router, and so on.