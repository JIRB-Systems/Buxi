// Página de un bus compartido (/v/<bus>, api/compartir.js): la persona que
// abre el enlace pasa al mapa siguiendo ese bus. Los lectores de tarjetas
// (WhatsApp, Facebook...) no corren JavaScript y se quedan con la tarjeta.
(function () {
  var m = location.pathname.match(/^\/v\/([0-9a-f-]{36})/i);
  location.replace(m ? '/passenger/map?bus=' + m[1] : '/passenger/map');
})();
