'use strict';

/**
 * Anonim avatarlar, rumuzlar ve cinsiyetsiz Doğruluk / Cesaret soru kartları.
 */

const ANONYMOUS_AVATARS = [
  { id: 'fox', emoji: '🦊', label: 'Tilki' },
  { id: 'owl', emoji: '🦉', label: 'Baykuş' },
  { id: 'wolf', emoji: '🐺', label: 'Kurt' },
  { id: 'mask', emoji: '🎭', label: 'Maske' },
  { id: 'cat', emoji: '🐱', label: 'Kedi' },
  { id: 'eagle', emoji: '🦅', label: 'Şahin' },
  { id: 'panda', emoji: '🐼', label: 'Panda' },
  { id: 'octopus', emoji: '🐙', label: 'Ahtapot' },
  { id: 'butterfly', emoji: '🦋', label: 'Kelebek' },
  { id: 'crystal', emoji: '🔮', label: 'Kahin' },
  { id: 'moon', emoji: '🌙', label: 'Gece' },
  { id: 'shades', emoji: '🕶️', label: 'Gölge' }
];

const ANONYMOUS_COLORS = [
  '#00f5d4',
  '#ff4d8d',
  '#ffb703',
  '#8b5cf6',
  '#38bdf8',
  '#fb7185',
  '#4ade80',
  '#f97316'
];

const NICK_ADJECTIVES = [
  'Gizli',
  'Mistik',
  'Sessiz',
  'Neon',
  'Gece',
  'Yıldız',
  'Kuzey',
  'Gölge',
  'Kozmik',
  'Rüzgar',
  'Sakin',
  'Parlak',
  'Derin',
  'Özgür'
];

const NICK_NOUNS = [
  'Tilki',
  'Baykuş',
  'Yolcu',
  'Kahin',
  'Fısıltı',
  'Pati',
  'Maske',
  'Kartal',
  'Ay',
  'Kıvılcım',
  'Pusula',
  'Gölge',
  'Dalga',
  'Yankı'
];

const TRUTH_CARDS = [
  { id: 't1', category: 'Eğlenceli', text: 'Bugüne kadar yaptığın en komik ama kimseye anlatmadığın sakarlık neydi?' },
  { id: 't2', category: 'Eğlenceli', text: 'Telefonunda en son kime mesaj attın ve mesaj neyle ilgiliydi?' },
  { id: 't3', category: 'Eğlenceli', text: 'Hayatında duyduğun en saçma bahane neydi, sen hiç kullandın mı?' },
  { id: 't4', category: 'Eğlenceli', text: 'Şu an odadaki birinin gizli bir özelliğini tahmin etmen gerekse ne derdin?' },
  { id: 't5', category: 'Eğlenceli', text: 'Kimse bakmıyorken yaptığın en garip alışkanlığın nedir?' },
  { id: 't6', category: 'Derin', text: 'Son bir yılda fikrinin tamamen değiştiği bir konu oldu mu? Neydi?' },
  { id: 't7', category: 'Derin', text: 'İnsanların senin hakkında en sık yanlış anladığı şey nedir?' },
  { id: 't8', category: 'Derin', text: 'Keşke zamanı geri alıp farklı davransaydım dediğin bir anın var mı?' },
  { id: 't9', category: 'Derin', text: 'Şu an hayatında en çok neyi başarmak veya değiştirmek istiyorsun?' },
  { id: 't10', category: 'Derin', text: 'Bir sırrı saklamak zorunda kalsan en fazla ne kadar dayanabilirsin?' },
  { id: 't11', category: 'Cesur', text: 'Sosyal medyada veya mesajlaşmada gizlice birinin profilini uzun uzun incelediğin oldu mu?' },
  { id: 't12', category: 'Cesur', text: 'Bir ortama girdiğinde ilk dikkat ettiğin detay nedir?' },
  { id: 't13', category: 'Cesur', text: 'Buradaki bir oyuncuya anonim olarak tek bir soru sorma hakkın olsa ne sorardın?' },
  { id: 't14', category: 'Cesur', text: 'Hayatında söylediğin en büyük beyaz yalan neydi?' },
  { id: 't15', category: 'Sosyal', text: 'Bir arkadaş ortamında sırf kırmamak için beğenirmiş gibi yaptığın en tuhaf şey neydi?' },
  { id: 't16', category: 'Sosyal', text: 'Gece yarısı uykun kaçtığında aklına en çok ne geliyor?' }
];

const DARE_CARDS = [
  { id: 'd1', category: 'Eğlenceli', text: 'En sevdiğin şarkının nakaratını 10 saniye boyunca sesli veya yazılı ritimle canlandır!' },
  { id: 'd2', category: 'Eğlenceli', text: 'Sadece emojiler kullanarak son yaşadığın komik olayı anlat; grup tahmin etsin.' },
  { id: 'd3', category: 'Eğlenceli', text: 'Bir sonraki tur sonuna kadar sohbete yazdığın her cümlenin sonuna gizemli bir ünlem veya emoji ekle.' },
  { id: 'd4', category: 'Eğlenceli', text: 'Gözlerini kapatıp rastgele 3 kelime söyle, sonra bunlarla tek cümlelik bir film özeti uydur.' },
  { id: 'd5', category: 'Sesli/Yaratıcı', text: 'Bir radyo sunucusu tonuyla bu anonim masanın son dakika haberini sun!' },
  { id: 'd6', category: 'Sesli/Yaratıcı', text: '15 saniye içinde masadaki bir kişiye tamamen doğaçlama bir iltifat şiiri uydur.' },
  { id: 'd7', category: 'Sesli/Yaratıcı', text: 'En sevdiğin film karakterinin repliğini dramatize ederek söyle veya yaz.' },
  { id: 'd8', category: 'Cesur', text: 'Telefonundaki son açtığın sekmenin veya en son dinlediğin şarkının adını dürüstçe paylaş!' },
  { id: 'd9', category: 'Cesur', text: 'Sana soruyu soran kişinin belirleyeceği tek kelimelik yeni bir lakabı 2 tur boyunca kullan!' },
  { id: 'd10', category: 'Cesur', text: 'Şu an aklından geçen ilk itirafı tek cümlede sansürsüzce (kurallar çerçevesinde) paylaş.' },
  { id: 'd11', category: 'Sosyal', text: 'Masadaki her oyuncuya anonim karakterine uygun tek kelimelik bir unvan ver.' },
  { id: 'd12', category: 'Sosyal', text: 'Bir sonraki turda şişe kime denk gelirse ona destekleyici gizemli bir motto yaz.' }
];

function generateAnonymousNickname() {
  const adj = NICK_ADJECTIVES[Math.floor(Math.random() * NICK_ADJECTIVES.length)];
  const noun = NICK_NOUNS[Math.floor(Math.random() * NICK_NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 89);
  return `${adj} ${noun} #${num}`;
}

function getRandomCard(mode, category = null) {
  const pool = mode === 'dare' ? DARE_CARDS : TRUTH_CARDS;
  const filtered = category && category !== 'Tümü'
    ? pool.filter((item) => item.category === category)
    : pool;
  const source = filtered.length > 0 ? filtered : pool;
  return source[Math.floor(Math.random() * source.length)];
}

module.exports = {
  ANONYMOUS_AVATARS,
  ANONYMOUS_COLORS,
  TRUTH_CARDS,
  DARE_CARDS,
  generateAnonymousNickname,
  getRandomCard
};
