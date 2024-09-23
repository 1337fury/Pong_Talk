import json
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async, async_to_sync
from channels.db import database_sync_to_async
from jwt import decode as jwt_decode


def get_redis_client():
    from django.conf import settings
    return settings.REDIS


class MatchMakingConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        from django.conf import settings
        self.cookies = self.scope['cookies']
        self.access = self.cookies.get(settings.AUTH_COOKIE)

        if self.access:
            self.player = await self.get_user_from_access_token(self.access)
            print(f'Player {
                  self.player.username} connected to matchmaking from yabad was here!!!')
        else:
            self.player = None

        if not self.player or not self.player.is_authenticated:
            print('Player not authenticated')
            await self.close()
        else:
            print(f'Player {self.player.username} connected to matchmaking')
            await self.accept()
            await self.add_to_queue(str(self.player.id))

    async def get_user_from_access_token(self, access_token):
        from django.conf import settings
        from pong_service.apps.authentication.models import Player
        from jwt import InvalidTokenError
        from rest_framework_simplejwt.exceptions import TokenError
        try:
            decoded_token = await sync_to_async(jwt_decode)(access_token, settings.SECRET_KEY, algorithms=['HS256'])
            user_id = decoded_token.get('user_id')

            if user_id is None:
                return None

            user = await sync_to_async(Player.objects.get)(id=user_id)
            return user
        except (TokenError, InvalidTokenError, Player.DoesNotExist):
            return None

    async def disconnect(self, code):
        await self.remove_from_queue(str(self.player.id))

    async def receive(self, text_data):
        data = json.loads(text_data)
        if data.get('action') == 'cancel_matchmaking':
            await self.remove_from_queue(str(self.player.id))
            await self.send(text_data=json.dumps({
                'status': 'cancelled',
                'message': 'Matchmaking cancelled'
            }))

    @database_sync_to_async
    def get_player(self, username):
        from pong_service.apps.authentication.models import Player
        try:
            return Player.objects.get(username=username)
        except Player.DoesNotExist:
            return None

    async def add_to_queue(self, player_id):
        await self.add_to_redis_queue(player_id)
        await self.match_players()

    @sync_to_async
    def add_to_redis_queue(self, player_id):
        redis_client = get_redis_client()
        redis_client.rpush('game_queue', player_id)

    @sync_to_async
    def remove_from_queue(self, player_id):
        redis_client = get_redis_client()
        redis_client.lrem('game_queue', 0, player_id)

    async def match_players(self):
        queue_length = await self.get_queue_length()
        if queue_length >= 2:
            player1_id, player2_id = await self.get_players_from_queue()
            game_id = await self.create_game(player1_id, player2_id)
            await self.notify_players(player1_id, player2_id, str(game_id))

    @sync_to_async
    def get_queue_length(self):
        redis_client = get_redis_client()
        return redis_client.llen('game_queue')

    @sync_to_async
    def get_players_from_queue(self):
        redis_client = get_redis_client()
        player1_id = redis_client.lpop('game_queue').decode('utf-8')
        player2_id = redis_client.lpop('game_queue').decode('utf-8')
        return player1_id, player2_id

    @database_sync_to_async
    def create_game(self, player1_id, player2_id):
        from pong_service.apps.pong.models import PongGame
        game = PongGame.objects.create(
            player1_id=player1_id,
            player2_id=player2_id,
            status=PongGame.Status.PENDING
        )
        return game.id

    @sync_to_async
    def notify_players(self, player1_id, player2_id, game_id):
        channel_layer = self.channel_layer
        for player_id in [player1_id, player2_id]:
            async_to_sync(channel_layer.group_send)(
                f'matchmaking_{player_id}',
                {
                    'type': 'game_matched',
                    'game_id': game_id
                }
            )

    async def game_matched(self, event):
        await self.send(text_data=json.dumps({
            'status': 'matched',
            'game_id': event['game_id']
        }))


class PongConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()
        await self.send(text_data=json.dumps(
                        {'message': 'Connected to Pong Websocket'}
                        ))

    async def disconnect(self, close_code):
        pass

    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message = text_data_json['message']

        await self.send(text_data=json.dumps({
                        'message': f'yabadwashere : {message}'
                        }))
