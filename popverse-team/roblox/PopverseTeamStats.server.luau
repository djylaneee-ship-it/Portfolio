--[[
	Popverse Team — stats en direct
	================================
	À mettre dans ServerScriptService (Script, pas LocalScript) de chaque jeu du studio.

	1. Dans Popverse Team : projet du jeu > onglet Stats > « Relier le jeu » : copie l'URL et la CLÉ D'ENVOI.
	2. Colle-les ci-dessous (ENDPOINT et KEY).
	3. Roblox Studio > Game Settings > Security > « Allow HTTP Requests » = ON. Publie le jeu.

	Toutes les 30 s, chaque serveur envoie : joueurs connectés, places max, FPS serveur, ping moyen, durée de vie,
	version de la place. Les évènements (achats, records, erreurs…) s'envoient avec le module partagé :

		local PopverseStats = require(game.ServerScriptService:WaitForChild("PopverseTeamStats"):WaitForChild("Api"))
		PopverseStats.track("purchase", player, 99, { item = "VIP" })      -- (type, joueur ou nil, valeur, données)

	Les achats de Developer Products / Game Passes passés par MarketplaceService sont suivis automatiquement.
]]

local ENDPOINT = "https://VOTRE-PROJET.supabase.co/functions/v1/pt-roblox"
local KEY = "COLLE-ICI-LA-CLE-D-ENVOI-DU-PROJET"
local INTERVAL = 30

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Stats = game:GetService("Stats")
local MarketplaceService = game:GetService("MarketplaceService")

local started = os.clock()
local queue = {}

local function track(kind: string, player: Player?, value: number?, data: { [string]: any }?)
	if #queue >= 500 then table.remove(queue, 1) end
	table.insert(queue, {
		kind = kind,
		user_id = player and player.UserId or nil,
		value = value,
		data = data or {},
	})
end

-- Accessible par les autres scripts serveur : _G.PopverseStats.track(...)
_G.PopverseStats = { track = track }

local function averagePing(): number?
	local total, n = 0, 0
	for _, p in Players:GetPlayers() do
		local ok, ping = pcall(function() return p:GetNetworkPing() end)
		if ok and ping then total += ping * 1000; n += 1 end
	end
	return n > 0 and math.floor(total / n) or nil
end

local function send(closing: boolean?)
	if RunService:IsStudio() and not game:GetAttribute("PopverseStatsInStudio") then return end
	if KEY:find("COLLE") then return end
	local events = queue
	queue = {}
	local body = {
		action = "ingest",
		key = KEY,
		job_id = game.JobId ~= "" and game.JobId or "studio",
		place_version = game.PlaceVersion,
		players = #Players:GetPlayers(),
		max_players = Players.MaxPlayers,
		fps = math.floor(workspace:GetRealPhysicsFPS()),
		ping = averagePing(),
		uptime = math.floor(os.clock() - started),
		data = { memory_mb = math.floor(Stats:GetTotalMemoryUsageMb()), private = game.PrivateServerId ~= "" },
		events = events,
		closing = closing or nil,
	}
	local ok, err = pcall(function()
		HttpService:RequestAsync({
			Url = ENDPOINT,
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = HttpService:JSONEncode(body),
		})
	end)
	if not ok then
		warn("[PopverseTeam] envoi des stats impossible :", err)
		-- On garde les évènements pour le prochain essai.
		for _, e in events do table.insert(queue, e) end
	end
end

Players.PlayerAdded:Connect(function(p) track("join", p, nil, { account_age = p.AccountAge }) end)
Players.PlayerRemoving:Connect(function(p) track("leave", p) end)

MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
	if purchased then track("gamepass", player, nil, { id = passId }) end
end)
MarketplaceService.PromptProductPurchaseFinished:Connect(function(userId, productId, purchased)
	if purchased then
		local p = Players:GetPlayerByUserId(userId)
		local price = nil
		pcall(function() price = MarketplaceService:GetProductInfo(productId, Enum.InfoType.Product).PriceInRobux end)
		track("purchase", p, price, { id = productId })
	end
end)

game:BindToClose(function() send(true) end)

task.spawn(function()
	task.wait(3)
	while true do
		send(false)
		task.wait(INTERVAL)
	end
end)

