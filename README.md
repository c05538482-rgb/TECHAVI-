# TechAvı V2

Sıfırdan hazırlanmış TechAvı sürümü.

## Özellikler

- Kullanıcı API key girişi yok.
- ReefAPI key sadece Render environment variable olarak sunucuda tutulur.
- Trendyol + Hepsiburada + n11 araması.
- Sunucu tarafı 10 dakikalık cache.
- Aynı sorgu tekrarlandığında mümkün olduğunca ReefAPI çağrısı yapılmaz.
- Üyelik: kayıt / giriş / çıkış.
- Kullanıcılar PostgreSQL'de kalıcı tutulur.
- Fiyat alarmı PostgreSQL'de tutulur.
- Hedef fiyata düşünce alarm tetiklenir.
- Resend ayarlıysa e-posta gönderilir; ayarlı değilse alarm hesabın içinde görünür.
- E-posta doğrulaması V1'de zorunlu değildir.
- n11 için kampanya/sepette indirim fiyatı önceliklendirilir.
- Mobil uyumlu arayüz.

## Gerekli Render değişkenleri

REEF_API_KEY
DATABASE_URL
SESSION_SECRET

Opsiyonel:

RESEND_API_KEY
RESEND_FROM
APP_URL

## Veritabanı

Bu proje PostgreSQL kullanır. Neon gibi ücretsiz bir PostgreSQL sağlayıcısından bir veritabanı oluşturup DATABASE_URL değerini Render'a koyabilirsin.

Render Free dosya sistemi kalıcı değildir; bu yüzden kullanıcılar ve alarmlar JSON dosyasında tutulmaz.

## Lokal çalıştırma

1. npm install
2. .env oluştur
3. npm start
4. http://localhost:10000

## Not

Render Free web service 15 dakika trafik olmazsa uyur ve sonraki istekte yaklaşık 1 dakika içinde tekrar başlar. Bu uygulama koduyla çözülemez; sürekli açık kalması için ücretli Render compute gerekir.
