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

// --- کیبورد اصلی (قبل از استفاده تعریف شده) ---
const mainMenu = Markup.keyboard([
    ['🛒 خرید سرویس'],
    ['📋 مشاهده پلن ها', '📞 تماس با پشتیبانی']
]).resize();

// --- سیستم ضد اسپم بهینه شده ---
bot.use((ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    
    const now = Date.now();
    const lastReq = lastRequest.get(userId);
    
    if (lastReq && (now - lastReq) < 1000) { // کاهش به 1 ثانیه برای کاهش لگ
        return; // اسپم detected
    }
    
    lastRequest.set(userId, now);
    return next();
});

// --- استارت با پیام خوش آمدگویی ---
bot.start(async (ctx) => {
    const welcomeMessage = `🔥 سلام به ربات Privflood خوش آمدید 🔥

⚡ ربات تخصصی ارائه کانفیگ‌های باکیفیت و پرسرعت

✅ لطفا یکی از گزینه‌های زیر را انتخاب کنید:`;

    await ctx.reply(welcomeMessage, mainMenu);
});

// --- دکمه‌های منو ---
bot.hears('📞 تماس با پشتیبانی', async (ctx) => {
    await ctx.reply('◻️ @Privflood');
});

bot.hears('📋 مشاهده پلن ها', async (ctx) => {
    const caption = `🔥 PrivFlood | Premium Config\n\n✦ V2Ray • V2Box • NPV\n\n✓ آیپی آمریکا با پینگ فوق پایین 🇺🇸\n✓ سرعت پایدار و بدون افت کیفیت ⚡\n◈ مناسب اینستاگرام، یوتیوب و استریم بدون لگ 🛜\n◈ اتصال Stable با Latency بهینه و سرعت واقعی 🚀\n◈ مناسب استفاده روزمره، دانلود و وب‌گردی 🌐\n◈ تحویل آنی بعد از خرید ⚡`;
    
    try {
        await ctx.replyWithPhoto({ source: './price.png' }, { caption });
    } catch (err) {
        await ctx.reply(caption);
    }
});

// --- فرآیند خرید ---
bot.hears('🛒 خرید سرویس', async (ctx) => {
    await ctx.reply('سرویس مورد نظر را انتخاب کنید:', Markup.inlineKeyboard([
        [Markup.button.callback('🚀 دور زدن اینترنت ملی', 'bypass_int')]
    ]));
});

bot.action('bypass_int', async (ctx) => {
    await ctx.editMessageText('📦 حجم مورد نظر را انتخاب کنید:', Markup.inlineKeyboard([
        [Markup.button.callback('1GB - ۱۷۵,۰۰۰ تومان', 'buy_1Gb'), Markup.button.callback('2GB - ۳۳۰,۰۰۰ تومان', 'buy_2Gb')],
        [Markup.button.callback('3GB - ۵۰۰,۰۰۰ تومان', 'buy_3Gb'), Markup.button.callback('5GB - ۸۷۰,۰۰۰ تومان', 'buy_5Gb')]
    ]));
});

// --- پیام پرداخت با فرمت ویژه و دکمه کپی ---
bot.action(/buy_(.+)/, async (ctx) => {
    const volume = ctx.match[1];
    const price = prices[volume];
    
    userState.set(ctx.from.id, { 
        step: 'WAITING_SCREENSHOT', 
        volume: volume, 
        price: price, 
        time: Date.now() 
    });

    const paymentMsg = `✨ *خیلی ممنون که مارو انتخاب کردی* 🙏🏻💗

💰 مبلغ مورد نیاز: *${price}*

💳 *شماره کارت:* 
\`5047061112635608\`

👤 *نام دارنده کارت:* مانی حیدری

📸 *مراحل بعد از واریز:*
1️⃣ اسکرین شات رسید رو بگیرید
2️⃣ همینجا ارسال کنید
3️⃣ منتظر تایید باشید

⏰ *مهلت ارسال رسید:* ۱ ساعت

✅ بعد از تایید، کانفیگ براتون ارسال میشه`;

    await ctx.reply(paymentMsg, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📋 دریافت شماره کارت برای کپی', callback_data: 'copy_card' }]
            ]
        }
    });
});

// --- دکمه کپی شماره کارت ---
bot.action('copy_card', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.reply('🔢 *شماره کارت برای کپی:*\n\n`5047061112635608`', {
            parse_mode: 'Markdown'
        });
        await ctx.reply('💡 روی عدد کلیک کنید، سپس گزینه Copy رو بزنید!');
    } catch (err) {
        console.error('Error in copy_card:', err);
    }
});

// --- دریافت اسکرین‌شات (بهینه شده) ---
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState.get(userId);
    
    if (state && state.step === 'WAITING_SCREENSHOT') {
        const elapsed = (Date.now() - state.time) / 1000 / 60;
        
        if (elapsed > 60) {
            await ctx.reply('⏰ مهلت یک ساعته شما تمام شده است. لطفا دوباره از بخش خرید سرویس اقدام کنید.');
            userState.delete(userId);
            return;
        }

        await ctx.reply('📸 رسید شما دریافت شد و برای مدیریت ارسال گردید. لطفا صبور باشید ⏳');

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
bot.action(/reject_(.+)/, async (ctx) => {
    const targetId = ctx.match[1];
    await bot.telegram.sendMessage(targetId, '❌ شرمنده اسکرین شات شما توسط ادمین رد شد ❌');
    await ctx.reply('❌ خرید کاربر رد شد.');
    await ctx.answerCbQuery();
});

bot.action(/set_config_(.+)/, async (ctx) => {
    const targetId = ctx.match[1];
    await ctx.reply(`✏️ لطفا متن کانفیگ را برای ارسال به کاربر ${targetId} اینجا بفرستید:`);
    userState.set(ADMIN_ID, { step: 'ADMIN_SENDING_CONFIG', targetId: targetId });
    await ctx.answerCbQuery();
});

// --- دریافت متن کانفیگ از ادمین و تایید نهایی ---
bot.on('text', async (ctx) => {
    const adminId = ctx.from.id;
    if (adminId !== ADMIN_ID) return;

    const state = userState.get(adminId);
    if (state && state.step === 'ADMIN_SENDING_CONFIG') {
        const configText = ctx.message.text;
        const targetId = state.targetId;

        await bot.telegram.sendMessage(targetId, `✅ سرویس شما تایید شد ممنون از اعتمادتون 🙏🏻💗\n\n${configText}`);
        await ctx.reply('✅ سرویس تایید و برای کاربر ارسال شد.');
        userState.delete(adminId);
    }
});

// --- هندلر برای پیام‌های متنی که با استارت شروع نمیشن (اختیاری) ---
bot.on('text', async (ctx) => {
    // اگر کاربر پیام متنی غیر از دستورات اصلی فرستاد
    if (ctx.message.text && !ctx.message.text.startsWith('/')) {
        // اگه کاربر در حالت انتظار نبود، منو رو نشون بده
        if (!userState.has(ctx.from.id)) {
            await ctx.reply('لطفا از گزینه‌های منو استفاده کنید:', mainMenu);
        }
    }
});

// --- اجرای ربات با هندلر خطا ---
bot.launch().then(() => {
    console.log('✅ Bot PrivFlood is Online!');
    console.log('🤖 Bot started successfully at:', new Date().toLocaleString('fa-IR'));
}).catch((err) => {
    console.error('❌ Error starting bot:', err);
});

// --- مدیریت خطاهای global ---
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) {
    console.error('Unhandled Rejection:', err);
});

// مدیریت خروج
process.once('SIGINT', () => {
    console.log('Bot stopping...');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log('Bot stopping...');
    bot.stop('SIGTERM');
});