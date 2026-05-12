const { Telegraf, Markup } = require('telegraf');

// --- تنظیمات اختصاصی شما ---
const BOT_TOKEN = '8119138309:AAGqURYvQcHNrvWo6HLpll3NTETRx4T-PFI';
const ADMIN_ID = 7072004980; 

const bot = new Telegraf(BOT_TOKEN);

// دیتابیس موقت
const userState = new Map();
const lastRequest = new Map();

// --- لیست قیمت‌ها ---
const prices = {
    '1Gb': '۱۷۵,۰۰۰ تومان',
    '2Gb': '۳۳۰,۰۰۰ تومان',
    '3Gb': '۵۰۰,۰۰۰ تومان',
    '5Gb': '۸۷۰,۰۰۰ تومان'
};

// --- سیستم ضد اسپم ---
bot.use((ctx, next) => {
    const userId = ctx.from?.id;
    const now = Date.now();
    if (userId && lastRequest.has(userId)) {
        const diff = now - lastRequest.get(userId);
        if (diff < 1500) return; // فاصله ۱.۵ ثانیه‌ای بین درخواست‌ها
    }
    if (userId) {
        lastRequest.set(userId, now);
    }
    return next();
});

// --- کیبورد اصلی ---
const mainMenu = Markup.keyboard([
    ['خرید سرویس'],
    ['مشاهده پلن ها', 'تماس با پشتیبانی']
]).resize();

bot.start((ctx) => {
    ctx.reply('به ربات PrivFlood خوش آمدید! یکی از گزینه‌ها را انتخاب کنید:', mainMenu);
});

// --- دکمه‌های منو ---
bot.hears('تماس با پشتیبانی', (ctx) => {
    ctx.reply('◻️ @Privflood');
});

bot.hears('مشاهده پلن ها', async (ctx) => {
    const caption = `🔥 PrivFlood | Premium Config\n\n✦ V2Ray • V2Box • NPV\n\n✓ آیپی آمریکا با پینگ فوق پایین 🇺🇸\n✓ سرعت پایدار و بدون افت کیفیت ⚡\n◈ مناسب اینستاگرام، یوتیوب و استریم بدون لگ 🛜\n◈ اتصال Stable با Latency بهینه و سرعت واقعی 🚀\n◈ مناسب استفاده روزمره، دانلود و وب‌گردی 🌐\n◈ تحویل آنی بعد از خرید ⚡`;
    try {
        await ctx.replyWithPhoto({ source: './price.png' }, { caption });
    } catch (err) {
        ctx.reply(caption);
    }
});

// --- فرآیند خرید ---
bot.hears('خرید سرویس', (ctx) => {
    ctx.reply('سرویس مورد نظر را انتخاب کنید:', Markup.inlineKeyboard([
        [Markup.button.callback('دور زدن اینترنت ملی', 'bypass_int')]
    ]));
});

bot.action('bypass_int', (ctx) => {
    ctx.editMessageText('حجم مورد نظر را انتخاب کنید:', Markup.inlineKeyboard([
        [Markup.button.callback('1GB', 'buy_1Gb'), Markup.button.callback('2GB', 'buy_2Gb')],
        [Markup.button.callback('3GB', 'buy_3Gb'), Markup.button.callback('5GB', 'buy_5Gb')]
    ]));
});

bot.action(/buy_(.+)/, (ctx) => {
    const volume = ctx.match[1];
    const price = prices[volume];
    
    userState.set(ctx.from.id, { 
        step: 'WAITING_SCREENSHOT', 
        volume: volume, 
        price: price, 
        time: Date.now() 
    });

    const paymentMsg = `خیلی ممنون که مارو انتخاب کردی 🙏🏻💗\n\nلطفا مبلغ ${price} به شماره کارت زیر واریز ، و اسکرین شات رسید رو ارسال کنید و منتظر شید تا تایید بشه. 🟢\n\n5047061112635608 💳\n\nنام دارنده کارت : مانی حیدری\n\nبرای کپی کردن شماره کارت کلیک کنید ⚡️\n\nبعد از نمایش این پیام یک ساعت فرصت دارید تا رسید خودتون رو ارسال کنید 🙏🏻✅`;
    
    ctx.reply(paymentMsg);
});

// --- دریافت اسکرین‌شات ---
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState.get(userId);
    
    if (state && state.step === 'WAITING_SCREENSHOT') {
        const elapsed = (Date.now() - state.time) / 1000 / 60;
        
        if (elapsed > 60) {
            ctx.reply('مهلت یک ساعته شما تمام شده است. لطفا دوباره از بخش خرید سرویس اقدام کنید.');
            userState.delete(userId);
            return;
        }

        ctx.reply('رسید شما دریافت شد و برای مدیریت ارسال گردید. لطفا صبور باشید ⏳');

        // Fixed: Properly get the photo file_id
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

        await bot.telegram.sendPhoto(ADMIN_ID, photoId, {
            caption: `📥 وصولی جدید!\n👤 کاربر: ${userId}\n🏷 نام: ${ctx.from.first_name}\n📦 سرویس: ${state.volume}\n💰 مبلغ: ${state.price}`,
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ قبول خرید (ارسال کانفیگ)', `set_config_${userId}`)],
                [Markup.button.callback('❌ رد خرید', `reject_${userId}`)]
            ])
        });
        userState.delete(userId);
    }
});

// --- پنل مدیریت ---
bot.action(/reject_(.+)/, (ctx) => {
    const targetId = ctx.match[1];
    bot.telegram.sendMessage(targetId, 'شرمنده اسکرین شات شما توسط ادمین رد شد ❌');
    ctx.reply('خرید کاربر رد شد.');
    ctx.answerCbQuery();
});

bot.action(/set_config_(.+)/, (ctx) => {
    const targetId = ctx.match[1];
    ctx.reply(`لطفا متن کانفیگ را برای ارسال به کاربر ${targetId} اینجا بفرستید:`);
    userState.set(ADMIN_ID, { step: 'ADMIN_SENDING_CONFIG', targetId: targetId });
    ctx.answerCbQuery();
});

// --- دریافت متن کانفیگ از ادمین و تایید نهایی ---
bot.on('text', (ctx) => {
    const adminId = ctx.from.id;
    if (adminId !== ADMIN_ID) return;

    const state = userState.get(adminId);
    if (state && state.step === 'ADMIN_SENDING_CONFIG') {
        const configText = ctx.message.text;
        const targetId = state.targetId;

        bot.telegram.sendMessage(targetId, `سرویس شما تایید شد ممنون از اعتمادتون 🙏🏻💗\n\n${configText}`);
        ctx.reply('✅ سرویس تایید و برای کاربر ارسال شد.');
        userState.delete(adminId);
    }
});

// اجرای ربات
bot.launch().then(() => console.log('Bot PrivFlood is Online!'));

// مدیریت خروج
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));