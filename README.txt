TechAvı — Güvenli Push + 3 Mağaza Patch

Bu patch mevcut TechAV repo klasöründe çalıştırılmak içindir.

Eklenen mağazalar: Amazon TR (com.tr), Pazarama, Çiçeksepeti.
Eklenen özellik: Web Push aboneliği, telefon bildirimlerini açma ve test bildirimi.

ÖNEMLİ: Trendyol / Hepsiburada / n11 mevcut arama ve fiyat mantığına dokunulmaz.

1) ZIP'i mevcut TechAV proje klasörüne çıkar.
2) O klasörde terminal aç ve: node apply_patch.js
3) package.json ve public/sw.js dahil güncellenen dosyaları kontrol et.
4) VAPID_KEYS.txt içindeki iki değeri Render Environment'a ekle.
5) VAPID_KEYS.txt dosyasını GitHub'a yükleme.
6) GitHub'a güncellenen package.json, server.js, public/app.js, public/index.html ve public/sw.js dosyalarını yükle.
7) Render → Manual Deploy → Deploy latest commit.

Not: Bu patch test bildirimi ve push aboneliğini kurar. Fiyat düştüğünde otomatik push için sunucunun kullanıcının ReefAPI anahtarına güvenli şekilde erişmesi gerekir; mevcut sürüm anahtarı tarayıcıda tutmaya devam eder. Bu nedenle otomatik fiyat düşüş push'u bu patch ile kendiliğinden aktif olmuş sayılmaz.
