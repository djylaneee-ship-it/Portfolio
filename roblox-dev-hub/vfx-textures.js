// Textures VFX de Rovex : les IDs Roblox (rbxassetid) des textures de particules, flipbooks et decals de
// l'utilisateur. Claude les retrouve avec l'outil find_vfx_textures ; l'app les affiche (page Textures VFX).
// Section « Build Textures » (kind 'build') : textures de surfaces pour les builds (sol, bois, pierre),
// données à Claude par find_build_textures, avec leurs images.
// La liste de base est écrite telle que l'admin l'a donnée ; parse() comprend aussi les listes collées
// plus tard dans l'app (même format : « * id — Nom (Groupe) · 4x4 », « 4x4 : id, id… », « Wind : id, id… »).

const RAW = `
1. ParticleEmitters nommés (Kit)
Burst / Misc
* 13800702582 — ToonBird (Misc) · flipbook 4x4
* 13801373992 — ToonMuzzle (Misc_2) · 2x2
* 13801456121 — ToonMuzzleContrast (Misc_2) · 2x2
* 13802408466 — ToonPetal (Misc_3) · 4x4
* 13803462600 — BezierLineCenter (Misc_5) · 8x8
* 13803008213 — BezierLineCorner (Misc_4) · 8x8
* 13803331652 — BezierLineCenter (Misc_4) · 8x8
* 13736805356 — SmokeBurst1 (Burst_1) · 4x4
* 13736993818 — SmokeBurst1_Contrast (Burst_1) · 4x4
* 13795445083 — Burst_Contrast (Burst_2) · 4x4
* 13795988483 — Burst_Contrast (Burst_3) · 4x4
* 13799487197 — Realistic (Burst_4) · 4x4
* 13799700420 — Realistic_WaveNoise (Burst_4) · 4x4
* 13800461961 — Realistic_Contrast (Burst_5) · 4x4
* 11868400571 — CircularBurst (Radial Burst) · 4x4
* 11855202643 — Radial Twirl (Kamui Twirl) · 4x4
* 11855280716 — Radial Twirl Contrast (Kamui Twirl) · 4x4
Slash / Flash / Smoke
* 13914839907 — Effect2 (Slash) · 4x4
* 13914836240 — Effect1 (Slash) · 4x4
* 13917466022 — Effect1 (Slash) · 4x4
* 13914823815 — Effect (Slash) · 4x4
* 13914837887 — Effect2 (Slash) · 4x4
* 13918130865 — Effect (Slash) · 4x4
* 13918138502 — Effect1 (Slash) · 4x4
* 13918139560 — Effect2 (Slash) · 4x4
* 13918140779 — Effect3 (Slash) · 4x4
* 14133700942 — Effect1 (Slash) · 4x4
* 14133705785 — Effect2 (Slash) · 4x4
* 14133703213 — Effect3 (Slash) · 4x4
* 14133710698 — Effect4 (Slash) · 4x4
* 14133763772 — Effect1 (Slash) · 4x4
* 14147545776 — Effect (Slash) · 4x4
* 14147512677 — Effect1 (Slash) · 4x4
* 14147516093 — Effect2 (Slash) · 4x4
* 14147517730 — Effect3 (Slash) · 4x4
* 13604373157 — dw (Slash) · 4x4
* 13416781743 — Fire (Slash) · 4x4
* 13416661606 — Fire (Slash) · 2x2
* 14132563173 — Flash · 4x4
* 14134183206 — Flash · 4x4
* 14134156205 — Flash · 4x4
* 14148836826, 14132577471, 14149349264, 14163088509, 14132309660, 14157952031, 14157810708, 14148470439, 14147256093, 14133104175, 14158214016 — Smoke · 4x4
Fire_Dissipate (tous flipbook 4x4)
* 11843276133 — ToonFire (1)
* 11843575561 — ToonFireContrast (1)
* 11844017484 — RealisticFire (1)
* 11844402871 — Pixel Fire (1)
* 13743820968 — Fire_1_Realistic (1)
* 13743936715 — Fire_1_Toon_Contrast (1)
* 13765167337 — Fire_1_Toon (1)
* 11846119288 — ToonFire (2)
* 11846336638 — RealisticFire (2)
* 11847035494 — PixelFire (2)
* 13745021655 — Fire_2_Realistic (2)
* 13765047699 — Fire_2_Toon (2)
* 13745032239 — Fire_2_Toon_Contrast (2)
* 11853980698 — RealisticFireRough (3)
* 11852978685 — ToonFire (3)
* 11854297993 — RealisticFire (3)
* 11854613172 — PixelFire (3)
* 13763005781 — Fire_3_Toon (3)
* 13762974205 — Fire_3_Toon_Contrast (3)
* 13762623803 — Fire_3_Realistic (3)
* 11855544753 — ToonFire (4)
* 11857153748 — ToonFireContrast (4)
* 11858203067 — RealisticFire (4)
* 11858773923 — PixelFire (4)
* 13764075574 — Fire_4_Realistic_Contrast (4)
* 13764308620 — Fire_4_Toon_Contrast (4)
* 13764868184 — Fire_4_Toon_Contrast (5)
* 13764992917 — Fire_4_Toon (5)
* 13765238618 — Fire_4_Realistic (5)
Smoke_Dissolve (tous flipbook 4x4)
* 11773081059 — ToonSmoke (1)
* 11822996479 — RealisticSmoke (1)
* 11823051025 — PixelSmoke (1)
* 11866632577 — AmbienceSmoke (1)
* 13717823765 — 2P_RSmoke1 (1)
* 13718060871 — 2P_RSmoke1_Contrast (1)
* 13771290435 — ToonLightning (1)
* 13771592635 — ToonLightning_Contrast (1)
* 11826642105 — RealisticSmoke (2)
* 11825921201 — ToonSmoke (2)
* 11826696782 — RealisticSmokeContrast (2)
* 11826888424 — PixelSmoke (2)
* 11866744589 — AmbienceSmoke (2)
* 11866794293 — AmbienceSmokeContrast (2)
* 13722306832 — 2P_RSmoke1 (2)
* 13722228396 — 2P_RSmoke1_Contrast (2)
* 13771935078 — ToonLightning (2)
* 11827618350 — ToonSmoke (3)
* 11827778171 — PixelSmoke (3)
* 11841348746 — RealisticSmoke (3)
* 11867375448 — AmbienceSmoke (3)
* 13724238656 — 2P_RSmoke3 (3)
* 13724252630 — 2P_RSmoke3InnerDark (3)
* 13773336783 — ToonLightning (3)
* 11841836676 — ToonSmokeContrast (4)
* 11842007223 — ToonSmoke (4)
* 11842149409 — ToonSmokePlain (4)
* 11842749937 — PixelSmoke (4)
* 11842590711 — RealisticSmoke (4)
* 11867465395 — AmbienceSmoke (4)
* 13726321388 — 2P_RSmoke3Realistic (4)
* 13726311040 — 2P_RSmoke3Toon (4)
* 13778464872 — ToonLightning (4)
* 13778471930 — ToonLightning_Contrast (4)
* 11871320339 — AmbienceSmoke5 (5)
* 13727078625 — 2P_RSmoke3Realistic (5)
* 13743483729 — 2P_RSmoke3RealisticV2 (5)
* 13780092154 — ToonLightning (5)
Lightning (tous flipbook 4x4)
* 11861733639 — ToonLightning (1)
* 11861743946 — ToonLightningContrast (1)
* 11864126734 — PixelLightning (1)
* 11861802341 — ToonLightning (2)
* 11861841517 — ToonLightningContrast (2)
* 11864126449 — PixelLightning (2)
* 11862032588 — ToonLightning (3)
* 11862051043 — ToonLightningContrast (3)
* 11864126298 — PixelLightning (3)
* 11862160354 — ToonLightning (4)
* 11862186106 — ToonLightningContrast (4)
* 11864126141 — PixelLightning (4)
Crack / Slash / Water Dissolve (tous flipbook 4x4)
* 13781849388 — Realistic (Crack_1)
* 13782458713 — Realistic (Crack_2)
* 13782885260 — Realistic (Crack_3)
* 13783882492 — Realistic (Crack_4)
* 13784241004 — Realistic_Contrast (Crack_4)
* 13791494193 — Realistic (Crack_5)
* 13791531657 — Realistic_Contrast (Crack_5)
* 13780281187 — Colored (Slash_1)
* 13780268621 — Alpha (Slash_1)
* 12817881196 — Alpha (Slash_2)
* 13804726357 — Alpha (Slash_3)
* 13804657607 — Colored (Slash_3)
* 13805841956 — Alpha (Slash_4)
* 13805828128 — Colored (Slash_4)
* 13806159635 — Alpha (Slash_5)
* 13806175054 — BlackInside (Slash_5)
* 13793478538 — Toon (Water_1)
* 13793551259 — Toon (Water_2)
* 13793926944 — Realistic (Water_3)
* 13793976664 — Realistic_Contrast (Water_3)
* 13794002023 — BlackPatches (Water_3)
* 13794844031 — Toon (Water_4)
* 13795304468 — Toon (Water_5)
Eau / Glace
* 11845281419 — ToonLiquidAlpha (WaterBurst) · 4x4
* 11845644255 — ToonLiquidColor (WaterBurst) · 4x4
* 11866455263 — RealisticBurst (WaterBurst) · 4x4
* 11866495294 — PixelBurst (WaterBurst) · 4x4
* 11868043658 — ToonBubblePop (WaterBurst) · 4x4
* 11868250246 — PixelBubblePop (WaterBurst) · 4x4
* 11864614229 — ToonRippleLoop (WaterRipple) · 8x8
* 11865130475 — PixelRipple (WaterRipple) · 4x4
* 11865187518 — RealisticRippleLoop (WaterRipple) · 8x8
* 11865207797 — RealisticRippleLoopContrast (WaterRipple) · 8x8
* 13953700240 — Ripple1 (Waterfalls Ripple) · 4x4
* 13953717713 — Ripple2 (Waterfalls Ripple) · 4x4
* 12356442287 — Splash1 (Waterfalls Ripple) · 4x4
* 13711999895 — Sparkle (Waterfalls Ripple)
* 12942158384 — Dots (Waterfalls Ripple)
* 13887130388 — Burst (IceMagichit) · 4x4
* 13712004355 — AnimatedCircle (IceMagichit) · 4x4
* 13887157156 — Flare2 (IceMagichit)
* 13887114225 — Dots (IceMagichit)
* 12506449597 — Wind (IceMagichit)

2. Flipbooks sans nom (Kit)
4x4 : 14106379216, 14117822736, 14119169004, 14150560623, 13992083690, 12350056117, 13052525496, 14106669939, 14106674607, 13973467824, 14117827133, 14039691837, 14141676861, 13992066650, 13992190852, 13992197350, 13992202083, 13992224965, 13992220545, 14004151283, 14004161351, 14004739953, 14006773822, 13180760354, 13712007292, 12757089364, 14152768329, 11372606236, 13712002536, 13992214801, 14004145197, 14004722845, 14006234837, 14028720860, 14083067299, 14162037963, 14162656592, 14162683221, 14162686582, 14162698198, 14162694001, 14162701953, 14162708907, 14162711722, 14163162698, 14164156363, 14166133842, 13712001094, 13973332586, 13972837092
8x8 : 13992057187, 14004727601, 11627083142, 12414215754, 13712000835, 13712003438, 13712003050
2x2 : 14006737380

3. Decals nommés (Kit)
* 75202463 — Dim burst light
* 6479321476 — Wholesome Hearts
* 669133414 — Small 4 Pointed star
* 296874871 — Big 4 Pointed star
* 6475162564 — Leaf
* 915916073 — Colorless Leaf
* 419625073 — Rain
* 42427179 — Snowflake
* 242213983 — Spooky ghost
* 6479253935 — Star cluster
* 3916186365 — Wind swirl A
* 7107683672 — wind
* 8223451413 — lightning
* 8189653993 — Lightning
* 8037777212 — Wind (use squash -1)
Wind : 10352559573, 6863041721, 10352563514, 10352556798, 7415024711, 10352566235, 8071207852, 10352554571, 7387037753, 10352551950, 10423614733, 8030839542, 10537588488, 10598374841, 8708744804, 8663057988, 10335420522, 9997556038, 8084996370, 8189326437, 7850765439, 10423611313, 10335418884, 7265756294, 243160943, 11201546023, 11201544574, 11201541666, 11201539270, 11192866186, 11192758174, 8050136743, 10423609590, 7265755321, 11192614305, 8030746658, 10423607514, 10335161708, 6955757898, 11362424823, 11362406261, 11373281038, 10263067827, 10358014393, 11362067232, 11336710093, 11362249226, 10357935135, 10423605602, 10335159416, 6955806741, 11362338440, 11362490107, 5076152048, 10423603715, 10423601618, 10335155912, 10317000242, 6963246954, 6963247592, 11373300948, 9973574373, 8250000734, 8077816591, 10423599002, 10031303479, 10317055952, 5210454496, 10558425570, 11392234336, 10439119562, 10747986900, 6963246544, 7294479235, 8292854478, 11593142512, 11492870634, 11669829539, 11669833150, 11669836654, 11669838662, 12802907064

4. Decals sans nom (Kit)
3029306948, 8511527728, 6928325971, 3318493505, 6594369527, 8133845150, 7524787479, 569507523, 9533344415, 6954174382, 13712006924, 13712002093, 13712001736, 14163790865, 253188732, 5872447086, 8610473870, 243043229, 1058335870, 6119272027, 626588936, 358965513, 8620924769, 8114157061, 6590251003, 8612048548, 278520320, 243660364, 248764835, 8271495905, 243432382, 6369896729, 5561954395, 8617980454, 8620925368, 8620925663, 242911609, 6354867625, 270446290, 11114688219, 8617740974, 303195022, 341277531, 8612240783, 7096972007, 8617787647, 7083340510, 288392896, 7814053668, 4976779930, 6660412891, 6603835352, 8114032502, 8114033129, 8133326767, 8047796070, 8611887703, 8611887361, 13917045341, 14006787869, 11189079998, 11862493383, 13712007548, 13576015697, 13703813488, 13909361910, 13917040265, 13972642464, 13972693228, 13973390393, 8581659659, 14007518610, 14117434366, 14149522288, 8172249266, 14162753420, 14163204987, 14164260155, 14006783533, 13712006632, 13712011229, 13887205600, 11364097059, 14117432455, 13550807043, 11705672210, 14162128187, 13712004045, 13712010449, 9181472421, 13919778556, 13931793771, 12505327959, 13712004842, 13712010899, 13973317169, 13030806457, 13504296914, 12104767407, 14005262616, 14006332061, 13492803558, 11425477167, 14163281710, 14163287554, 13776019823, 13712003725, 13712010201, 12505124986, 10843348496, 12102003705, 13027513864, 9281305957, 14005221169, 13273908539, 10176632695, 14163275307, 10369597080, 14163269969, 13973691971, 14017129441, 10468554009, 10890181552, 14163208805, 14166324267, 14004879118

5. More Textures — nommés
* 8376012789 — HehB
* 10366692636 — Flip
* 7994997277 — HowToTexture
* 243728206 — Even Shine
* 243728166 — Burst light
* 867619398 — Super Gradient
* 242292288 — Gradient square
* 755925534 — Nebula
* 196969716 — Big gradient circle
* 448862775 — Oval gradient
* 243664672 — Small gradient circle
* 5726444189 — Wind swirl B
* 1525327413 — Glow
* 6707322206 — Small 4 Pointed star
* 244221535 — Big 4 Pointed star
* 6201773939 — Bubble
* 249902641 — Big bubble
* 243728104 — Idk what this is but it looks cool
* 933102662 — Small fog
* 2122546039 — Fog cluster
* 528256032 — Big fog
* 1946917526 — Dense fog
* 298984512 — Star sparkle
* 2866648598 — Sharp Ring
* 6110499276 — Fireworks
* 6479250779 — Comet
* 917186750 — Heavy odd shine
* 1454292685 — Light odd shine
* 6602413638 — Leaf
* 243098098 — Spark
* 6479313834 — Lightingbolt
Slash : 4231233461, 9344416903, 917189380, 917188138, 9377181444, 321556991, 6561027080, 917181007, 9573351641, 426653646, 7264950759, 7405798505, 8553497052, 9263377611, 6900421146, 507021722, 4543893907, 6250126210, 6700006778, 7130084926, 9345352897, 1012159668, 8779210242, 7150933366, 1598630577, 9376967285, 6700005265, 7648565918, 9409091712, 7447854952, 9449395070, 332491482

6. More Textures — sans nom
1084976679, 9533204395, 14512622421, 14511851045, 14511850772, 14511850485, 14511850158, 14511851231, 14511839695, 14511835443, 14511823947, 14511851514, 14511842970, 14511844450, 14511828570, 14511827719, 14511851788, 14511844213, 14511829198, 14511831163, 14512621777, 14512613131, 14511827036, 14511818940, 14512618965, 14512612724, 14512618584, 14512614693, 1177196540, 9563783367, 9563795422, 9563782855, 8187305477, 6654271542, 1380079888, 7216854486, 9563928814, 7216854379, 7216854285, 7216848699, 7216849594, 7216853637, 7216855489, 7216851723, 281763734, 7216855238, 7216850580, 7216855364, 7948793250, 9563728434, 9563588001, 9563785251, 242102147, 7250560778, 6203493685, 1512913149, 7948792468, 1467433436, 8187305308, 1861106267, 425665059, 623219622, 8214519968, 8214516794, 1084955012, 9533206334, 10365551510, 1084962479, 14512617877, 14512623313, 14512622755, 14512622998, 14511841114, 14512614082, 14511832017, 14512625622, 14511840952, 14512630978, 14511830556, 14512617094, 14512614488, 14512616723, 14512627343, 14512629603, 394144370, 14512625107, 14511832750, 14512623760, 14512628259, 14512625987, 14511831403, 14511831815, 14512619365, 14511838480, 14511844013, 14512628457, 14511832267, 14511833039, 14511817300, 7948830830, 7216854921, 7216851474, 9563816638, 7216848960, 9563781236, 9563780895, 9563782085, 8210105100, 7216848832, 7216856276, 7216853898, 1164713030, 1075864321, 8187306950, 7216852206, 7216852121, 7216852306, 7216847656, 7216847514, 7216847765, 7216849075, 7216856158, 398139001, 7948825861, 7216852934, 7216850212, 388415152, 7948796697, 7216852679, 7216850429, 384954302, 7948795210, 7216855136, 9563789443, 9563800758, 1277456789, 1851669703, 515986879, 389222402, 8187307611, 394323831, 1858602290, 516660287, 1277447946, 8214519369, 9541054556, 9541054718, 9541054923, 8214517543, 14512617375, 9533206478, 9533204568, 9533204862, 1084987256, 9533206597, 1084975295, 8214519774, 10365550581, 14511842748, 14511829399, 14511833371, 14511836095, 14512623590, 14512626764, 14511840554, 14511842475, 14511824913, 14511848233, 14511836652, 14511819742, 14512628030, 14511819307, 14511819543, 14512616877, 14511833635, 14511828896, 14512619885, 14511830281, 14512620103, 14511829642, 14511821646, 14511823193, 14511841345, 14511822680, 14511838812, 14512624490, 14512624790, 14512619622, 14512623971, 14511834352, 14511834108, 14511833883, 14511824206, 14512620837, 6479341134, 9563592015, 1470871817, 7216855813, 9563796583, 1467654679, 76990331, 7216855595, 9563595028, 225666521, 7216855695, 410786214, 7216855030, 7216850983, 511303414, 255160946, 836060185, 9563594300, 9563725311, 8187306832, 8180428772, 9563790132, 7216854591, 9563783593, 9563796105, 7216849703, 9563792512, 7216849325, 9563790939, 7216855914, 7216849471, 8187307109, 1266209505, 9533207066, 8187307788, 7832491488, 7216856024, 7216856402, 7216853770, 2512988643, 10365553921, 10365549270, 1266209618, 1266209745, 1084963972, 883906867, 836035207, 243474653, 1084987899, 6172932083, 122434532, 311395391, 7948615545, 1503030545, 426579110, 1314109432, 1803393098, 392758851, 1263079249, 1379899761, 2316283203, 14512630210, 14511826269, 8214518976, 9533205508, 9533264910, 9533205153, 10365554384, 14511834917, 10365552478, 9533205744, 8214516993, 8214518193, 8214518833, 8214517928, 8214518056, 8214520142, 8214518612, 8214517790, 1084969997, 1084955488, 10365548630, 1084996536, 1084999891, 9533203298, 1084991215, 9533205006, 9541054323, 1084996976, 8214519581, 1084977655, 9563708138, 9563708852, 9533204017, 8214518341, 10365550877, 10365552890, 1084959112, 8214517377, 14511843304, 14511843672, 14511839474, 14511842212, 14511841908, 14511849962, 14511839853, 14511835627, 14512620314, 14512622066, 14512615522, 14512613515, 14511817510, 14511840016, 14511839170, 14511836865, 14512627076, 14512630510, 14512627669, 10365553480, 14511817038, 14512618074, 14511817809, 14511840734, 14512617569, 14512629878, 14511818658, 14511818405, 14512616500, 14511822105, 14511823475, 14511827335, 14511825243, 14512621233, 14511818094, 14511820215, 14512629289, 14511822436, 14511826103, 14511838195, 14512628984, 14511821364, 14511835160, 14512628750, 14511822922, 14511820455, 14511826680, 14511847678, 14511847979, 14511848942, 14511848650, 14512620537, 14511843126, 14512615734, 14511848447, 14511849157, 14511849396, 14511846693, 14511846393, 14511845153, 14511845483, 14511834587, 14511845831, 14511846159, 14511844942, 14511826517, 14512616294, 14512612294, 14512615154, 14512630755, 14512615348, 10365550281, 9533207455, 8187305869, 7948622114, 9563795060, 397458963, 9563818849, 7216847342, 9563819936, 7216847219, 9563784935, 7216846971, 9563732504, 9563732807, 9563933258, 9563933005, 9563932795, 9563932531, 9563931685, 7994629407, 1084966670, 9563792303, 9563792119, 9563791878, 9563929150, 7216848586, 7216848493, 6472896673, 397459035, 7948622386, 7948615765, 9533207256, 8187306581, 7216852545, 8187306179, 8187306423, 8187306008, 8187308602, 8187308460, 8187308349, 8187308218, 6337281108, 6602421253, 9563785574, 1463840694, 1463903184, 9563944066, 9563943869, 9563941846, 531628477, 9563944227, 9563945564, 9563733154, 9563585363, 9563798159, 1053551368, 9563788818, 7994628963, 7216851093, 7216851326, 9563810811, 255188888, 6277012948, 7216851225, 7332661633, 8187308066, 9563810958, 255161091, 9563783938, 8187305659, 9563589412, 9563793878, 9563793649, 255187041, 7216852799, 414284775, 413569800, 9563726020, 9563725822, 9563725604, 1084982817, 991687067, 1084952073, 1266170131, 1021559161, 7216854028, 9563708576, 10365549704, 8210105223, 7216854161, 7216849215, 8047533775, 4480871448, 5699911427, 5155825850, 414284607, 1849531275, 2443461141, 1078637959, 6671348341, 3916143220, 7953178806, 1084961641, 1053548563, 1084970835, 9533202968, 9533204713, 9533206120, 1084959583, 1053546634, 1084965356, 2058077944, 9541055154, 1084959312, 9533205884, 8214519194, 14511849550, 14511849699, 14511825825, 14512621521, 14512615963, 14512616144, 14511823766, 14511825501, 14511836379, 14511819968, 14511844739, 14511837514, 14511820953, 14511837255, 14511841567, 14512612463, 14512626498, 14512626261, 14512624206, 14511847315, 14511847076, 10365553156, 10365551141, 7216854783, 7216854681, 2083452767, 7216853032, 7216853129, 7216853466, 7216853342, 7216853231, 7216980507, 7216980203, 7216980646, 7216980374, 9563784745, 9563784467, 7216852031, 9563940572, 2048097307, 9563724604, 9563941122, 9563940860, 1244829143, 1084974286, 9563941378, 10365552059, 265788038, 7848213224, 243457340, 7216851605, 6091474388, 9563783751, 7216851879, 6091329339, 6091341618, 6893847210, 1269254614, 1084969783, 1315202524, 7216979807, 7216847958, 7216848307, 7216848149, 7216848401, 7216848219, 7216847852, 7994629137, 7216979617, 7216979522, 7216979701, 7216979191, 7216979305, 7216979420, 8187307323, 10365551764, 7994630128, 7994629852, 1262993978, 1463939561, 7948615986, 7948617084, 7948619931, 7948618410, 7948621618, 7216850022, 7216849788, 7216979919, 7216980052, 528280947, 6337277439
7. Build Textures (surfaces)
Build · Ground
* 10023806000 — Sand
* 10039979047 — Grass
Build · Wood
* 10024132565 — Wood
* 10024142572 — Wood (Variant 1)
* 10024179514 — Wood (Variant 2)
* 10024120805 — Wood Planks
* 10045446623 — Wood Fence
Build · Stone
* 10045364320 — Cobblestone
* 10041070183 — Cobblestone Wall
* 10040992600 — Rock
* 10025618174 — Rock (Variant)
`;

const ID_RE = /\b\d{6,13}\b/g;
const GRID_RE = /\b([248])x\1\b/;
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'textures';

// Type de texture d'après le titre de la grande section.
function kindOf(section) {
  if (/build|surface/i.test(section)) return 'build';
  if (/flipbook/i.test(section)) return 'flipbook';
  if (/particle|emitter/i.test(section)) return 'particle';
  if (/decal/i.test(section)) return 'decal';
  return 'texture';
}

// Lit une liste de textures (format ci-dessus). source : 'builtin' ou 'custom'.
function parse(text, { source = 'custom', section: startSection = 'Textures' } = {}) {
  const out = [];
  const seen = new Set();
  let section = startSection;
  let sub = '';
  let defGrid = null;
  const push = (id, extra) => {
    if (seen.has(id)) return;
    seen.add(id);
    const group = extra.group || (sub ? `${sub}` : section.replace(/\s*\(Kit\)\s*/i, ''));
    out.push({ id, name: '', section: section.replace(/^\d+\.\s*/, ''), kind: kindOf(section), flipbook: defGrid, source, ...extra, group, groupId: slug(group) });
  };
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const ids = line.match(ID_RE) || [];
    // « 1. ParticleEmitters nommés (Kit) » : grande section.
    if (/^\d+\.\s+\D/.test(line) && !ids.length) {
      section = line.replace(/^\d+\.\s*/, '').trim();
      sub = '';
      defGrid = /flipbook/i.test(section) ? '4x4' : null;
      continue;
    }
    // « Tous ces Fire_Dissipate sont en flipbook 4x4. » : grille par défaut du groupe.
    if (!ids.length && /flipbook/i.test(line) && GRID_RE.test(line) && /tous|all|sont/i.test(line) && !/^[A-Z][\w /]*\(/.test(line)) {
      defGrid = line.match(GRID_RE)[0];
      continue;
    }
    // Sous-titre : « Burst / Misc », « Smoke_Dissolve (tous flipbook 4x4) ».
    if (!ids.length && !line.startsWith('*')) {
      sub = line.replace(/\((?:tous|all)[^)]*\)/i, '').replace(/_/g, ' ').trim();
      const g = line.match(GRID_RE);
      defGrid = g ? g[0] : /flipbook/i.test(section) ? '4x4' : null;
      continue;
    }
    // « * id — Nom (Groupe) · 4x4 » (un ou plusieurs IDs avant le tiret).
    const bullet = line.match(/^\*?\s*([\d,\s]+?)\s*[—–-]\s*(.+)$/);
    if (bullet && (bullet[1].match(ID_RE) || []).length) {
      let rest = bullet[2];
      const g = rest.match(GRID_RE);
      rest = rest.replace(/·?\s*(?:flipbook\s*)?\b([248])x\1\b/i, '').replace(/\s*·\s*$/, '').trim();
      const sm = rest.match(/\(([^)]*)\)\s*$/);
      const name = (sm ? rest.slice(0, sm.index) : rest).trim();
      const paren = sm ? sm[1] : '';
      const isTip = /squash|use\s/i.test(paren); // « (use squash -1) » : un conseil, pas une variante
      for (const id of bullet[1].match(ID_RE)) {
        push(id, { name, variant: isTip ? '' : paren.replace(/_/g, ' '), flipbook: g ? g[0] : defGrid, tip: isTip ? paren : '' });
      }
      continue;
    }
    // « 4x4 : ids » ou « Wind : ids » : liste avec une étiquette.
    const label = line.match(/^([^:\d][^:]{0,40}|[248]x[248])\s*:\s*(.+)$/);
    if (label && (label[2].match(ID_RE) || []).length) {
      const grid = GRID_RE.test(label[1]) ? label[1].match(GRID_RE)[0] : null;
      const name = grid ? '' : label[1].trim();
      const group = name ? `${name} · ${section.replace(/^\d+\.\s*/, '').replace(/\s*(—|-).*$/, '').replace(/\s*\(Kit\)\s*/i, '')}` : '';
      for (const id of label[2].match(ID_RE)) push(id, { name, flipbook: grid || defGrid, variant: '', ...(group && { group }) });
      continue;
    }
    // Liste d'IDs sans nom.
    for (const id of ids) push(id, { variant: '' });
  }
  return out;
}

const BUILTIN = parse(RAW, { source: 'builtin' });

// Toutes les textures : celles de base + celles ajoutées par l'admin (partagées en ligne).
function all(state) {
  const custom = (state && state.textures && state.textures.items) || [];
  const ids = new Set(BUILTIN.map((t) => t.id));
  return BUILTIN.concat(custom.filter((t) => !ids.has(t.id)));
}

function groups(list) {
  const map = new Map();
  for (const t of list) {
    const g = map.get(t.groupId) || { id: t.groupId, label: t.group, section: t.section, kind: t.kind, count: 0 };
    g.count++;
    map.set(t.groupId, g);
  }
  return [...map.values()];
}

// Réglages conseillés pour un flipbook (Claude les reçoit avec chaque texture).
const LOOP_RE = /loop|ripple|ambience|aura|idle/i;
function flipbookHelp(t) {
  if (!t.flipbook) return undefined;
  const n = Number(t.flipbook[0]) ** 2;
  return {
    FlipbookLayout: `Enum.ParticleFlipbookLayout.Grid${t.flipbook}`,
    FlipbookMode: LOOP_RE.test(`${t.name} ${t.variant} ${t.group}`) ? 'Enum.ParticleFlipbookMode.Loop' : 'Enum.ParticleFlipbookMode.OneShot',
    frames: n,
    framerate: `FlipbookFramerate = NumberRange.new(${n} / Lifetime) so the ${n} frames play once over the particle's life`,
  };
}

function search(list, { query = '', group = '', flipbook = '', kind = '', limit = 40 } = {}) {
  const words = String(query).toLowerCase().split(/[\s,]+/).filter(Boolean);
  const score = (t) => {
    const hay = `${t.name} ${t.variant} ${t.group} ${t.section} ${t.kind} ${t.tip || ''} ${t.flipbook || ''}`.toLowerCase().replace(/_/g, ' ');
    let s = 0;
    for (const w of words) {
      if (!hay.includes(w)) return -1;
      s += (t.name.toLowerCase().includes(w) ? 3 : 0) + (t.group.toLowerCase().includes(w) ? 2 : 0) + 1;
    }
    return s + (t.name ? 1 : 0);
  };
  return list
    .filter((t) => (!group || t.groupId === group || t.group.toLowerCase() === String(group).toLowerCase()) && (!flipbook || t.flipbook === flipbook) && (!kind || t.kind === kind))
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 40)))
    .map(({ t }) => ({
      id: t.id, rbxassetid: `rbxassetid://${t.id}`, name: t.name || undefined, variant: t.variant || undefined, group: t.group,
      kind: t.kind, flipbook: t.flipbook || undefined, flipbookSettings: flipbookHelp(t), tip: t.tip || undefined,
    }));
}

// Miniatures des textures (API publique de Roblox), gardées 7 jours dans data/texture-thumbs.json.
const THUMBS_FILE = () => require('path').join(require('./db').DATA_DIR, 'texture-thumbs.json');
const readThumbs = () => { try { return JSON.parse(require('fs').readFileSync(THUMBS_FILE(), 'utf8')); } catch { return {}; } };
// size : 420x420 pour l'app (gardé en cache) ; une autre taille (ex. 250x250 pour Claude) n'est pas gardée.
async function thumbs(ids, size = '420x420') {
  if (size !== '420x420') return thumbsAt(ids, size);
  const cache = readThumbs();
  const week = 7 * 86400e3;
  const missing = [...new Set(ids)].filter((id) => /^\d+$/.test(id) && !(cache[id] && cache[id].url && Date.now() - cache[id].at < week));
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      const r = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${chunk.join(',')}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`, { signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      for (const d of j.data || []) cache[String(d.targetId)] = { url: d.state === 'Completed' ? d.imageUrl : '', state: d.state, at: Date.now() };
    } catch {}
  }
  if (missing.length) { try { require('fs').writeFileSync(THUMBS_FILE(), JSON.stringify(cache)); } catch {} }
  return Object.fromEntries(ids.map((id) => [id, (cache[id] || {}).url || '']));
}

async function thumbsAt(ids, size) {
  const out = {};
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const r = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids.slice(i, i + 100).join(',')}&returnPolicy=PlaceHolder&size=${size}&format=Png&isCircular=false`, { signal: AbortSignal.timeout(20000) });
      for (const d of (await r.json()).data || []) if (d.state === 'Completed') out[String(d.targetId)] = d.imageUrl;
    } catch {}
  }
  return Object.fromEntries(ids.map((id) => [id, out[id] || '']));
}

module.exports = { RAW, parse, all, groups, search, flipbookHelp, BUILTIN, thumbs, readThumbs };
