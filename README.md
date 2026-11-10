# Anonim Şişe Çevirmece • Doğruluk mu Cesaret mi

Tamamen anonim, cinsiyet seçimi olmadan oynanan, **2–6 kişilik** gerçek zamanlı **sesli ve yazılı** Doğruluk mu Cesaret mi (Şişe Çevirmece) web uygulaması (PWA uyumlu).

## Özellikler
- **Tam Anonimlik ve Cinsiyetsiz Giriş**: Girişte cinsiyet, ad veya kişisel bilgi istenmez. Yalnızca anonim rumuz, maskot avatar ve masa rengi seçilir.
- **Oda Sistemi (Min 2 • Max 6 Kişi)**:
  - **Herkese Açık Odalar**: Lobide listelenir ve tek tıkla katılınabilir.
  - **Özel Odalar**: Sadece 6 haneli oda kodu veya davet linki (`?room=KOD`) ile katılınır.
  - Oda kapasitesi **2 ile 6 kişi** arasında ayarlanır; oyunu başlatmak için sunucu tarafından en az 2 kişi zorunlu tutulur.
- **İki Sohbet Seçeneği (Sesli ve Yazılı)**:
  - `🎙️ + 💬 Sesli & Yazılı`: WebRTC tabanlı P2P sesli sohbet ve canlı metin sohbeti aynı anda açık.
  - `💬 Sadece Yazılı`: Mikrofon devre dışı, sessiz ve yazılı oyun.
  - `🎙️ Sadece Sesli`: Canlı mikrofon + Bas-Konuş (Space) ve konuşma halkası göstergesi.
- **Şişe Çevirmece Akışı**:
  - Şişe çevrildiğinde **şişenin ucu** *Cevaplayan* oyuncuyu, **şişenin arkası** ise *Soran* oyuncuyu belirler.
  - Cevaplayan **Doğruluk** veya **Cesaret** seçer.
  - Soran kişi ister **kendi sorusunu/görevini yazar**, ister **hazır kartlardan** seçer (veya sesli odada sesli sorar).

## Başlatma
1. `baslat.bat` dosyasına çift tıklayın **veya** terminalde çalıştırın:
   ```bash
   node server.js
   ```
2. Tarayıcıda `http://localhost:3000` adresini açın.
3. Çok oyunculu test için ikinci bir tarayıcı sekmesi açarak aynı oda koduna katılabilirsiniz.

## Testleri Çalıştırma
```bash
node --test tests/*.test.js
```

## İnternet Üzerinden Arkadaşlarla Oynama Notu
Tarayıcılar mikrofon erişimi (`WebRTC`) için `localhost` dışında **HTTPS** bağlantısı gerektirir. Uygulamayı Render, Railway veya Fly.io gibi ücretsiz bir Node.js platformuna yüklediğinizde otomatik HTTPS ile telefon ve bilgisayarlardan sesli sohbet doğrudan çalışır.
