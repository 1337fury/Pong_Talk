from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.db.models import Q
from .models import PongGame, GameRequest
from pong_service.apps.authentication.models import Player
from django.shortcuts import get_object_or_404
from django.conf import settings
from pong_service.apps.chat.consumers import NotificationConsumer
from pong_service.apps.pong.models import Tournament
import django.utils.timezone as timezone

import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class RequestGameView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        player = request.user

        # check if player is already in a game
        active_game = PongGame.objects.filter(
            Q(player1=player) | Q(player2=player),
            status__in=[PongGame.Status.PENDING, PongGame.Status.STARTED]
        ).first()

        if active_game:
            return Response({
                'status': 'error',
                'message': 'You already in game',
                'game_id': str(active_game.id)
            }, status=status.HTTP_400_BAD_REQUEST)

        # check if player is already in queue
        redis_client = settings.REDIS
        queue = redis_client.lrange('game_queue', 0, -1)
        if str(player.id).encode('utf-8') in queue:
            return Response({
                'status': 'error',
                'message': 'You are already in the matchmaking queue',
                'websocket_url': '/ws/matchmaking/'
            }, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'status': 'success',
            'message': 'Please connect to the matchmaking websocket',
            'websocket_url': '/ws/matchmaking/'
        }, status=status.HTTP_200_OK)


class RequestGameWithPlayerView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        player = request.user
        opponent_username = request.data.get('opponent_username')

        if not opponent_username:
            return Response({
                'status': 'error',
                'message': 'Please provide an opponent_username'
            }, status=status.HTTP_400_BAD_REQUEST)

        opponent = get_object_or_404(Player, username=opponent_username)
        
        # Check if opponent is online
        if not opponent.online:
            return Response({
                'status': 'error',
                'message': 'Opponent is not online'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Check if there's already an active game or request
        active_game = PongGame.objects.filter(
            (Q(player1=player) | Q(player2=player)) &
            Q(status__in=[PongGame.Status.PENDING, PongGame.Status.STARTED])
        ).first()

        if active_game:
            return Response({
                'status': 'error',
                'message': 'You are already in a game',
                'game_id': str(active_game.id)
            }, status=status.HTTP_400_BAD_REQUEST)

        active_request = GameRequest.objects.filter(
            (Q(requester=player) | Q(opponent=player)) &
            Q(status=GameRequest.Status.PENDING)
        ).first()

        if active_request:
            return Response({
                'status': 'error',
                'message': 'You already have a pending game request',
                'request_id': str(active_request.id)
            }, status=status.HTTP_400_BAD_REQUEST)

        # Create a new game request
        game_request = GameRequest.objects.create(
            requester=player,
            opponent=opponent,
            status=GameRequest.Status.PENDING
        )

        # Send a notification to the opponent
        NotificationConsumer.sendGameRequestNotification(player, opponent.id, str(game_request.id))

        return Response({
            'status': 'success',
            'message': 'Game request sent',
            'request_id': str(game_request.id)
        }, status=status.HTTP_201_CREATED)


class AcceptGameRequestView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        player = request.user
        request_id = request.data.get('request_id')

        if not request_id:
            return Response({
                'status': 'error',
                'message': 'Please provide a request_id'
            }, status=status.HTTP_400_BAD_REQUEST)

        game_request = get_object_or_404(
            GameRequest, id=request_id, opponent=player, status=GameRequest.Status.PENDING)

        # Create a new game
        game = PongGame.objects.create(
            player1=game_request.requester,
            player2=game_request.opponent,
            status=PongGame.Status.PENDING
        )

        # Update the game request status
        game_request.status = GameRequest.Status.ACCEPTED
        game_request.save()

        # Send a notification to the requester
        NotificationConsumer.sendGameRequestResponseNotification(game_request.requester.id, str(game.id))

        return Response({
            'status': 'success',
            'message': 'Game request accepted',
            'game_id': str(game.id)
        }, status=status.HTTP_200_OK)

class RejectGameRequestView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        player = request.user
        request_id = request.data.get('request_id')

        if not request_id:
            return Response({
                'status': 'error',
                'message': 'Please provide a request_id'
            }, status=status.HTTP_400_BAD_REQUEST)

        game_request = get_object_or_404(
            GameRequest, id=request_id, opponent=player, status=GameRequest.Status.PENDING)

        # Update the game request status
        game_request.status = GameRequest.Status.REJECTED
        game_request.save()

        # Send a notification to the requester
        NotificationConsumer.sendGameRequestResponseNotification(game_request.requester.id, None)

        return Response({
            'status': 'success',
            'message': 'Game request rejected'
        }, status=status.HTTP_200_OK)

class PlayerGamesView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, username):
        player = get_object_or_404(Player, username=username)

        games = PongGame.objects.filter(
            Q(player1=player) | Q(player2=player)
        )

        if not games:
            return Response({
                'status': 'success',
                'message': 'No games found for player'
            }, status=status.HTTP_200_OK)

        games_data = []
        for game in games:
            if game.player1.username == player.username:
                player_name = game.player1.username
                opponent = game.player2.username
                player_score = game.player1_score
                opponent_score = game.player2_score
            else:
                player_name = game.player2.username
                opponent = game.player1.username
                player_score = game.player2_score
                opponent_score = game.player1_score

            game_data = {
                "game_id": str(game.id),
                "player": player_name,
                "opponent": opponent,
                "winner": game.winner.username,
                "player_score": player_score,
                "opponent_score": opponent_score,
                "opponent_avatar": Player.objects.get(username=opponent).avatar_url,
                "date": game.created_at.strftime("%Y-%m-%d")
            }
            games_data.append(game_data)

        response_data = {"matches": games_data}
        return Response(response_data, status=status.HTTP_200_OK)

class TournamentCreateView(APIView):
    permission_classes = (IsAuthenticated,)
    
    def post(self, request):
        player = request.user
        player2_username = request.data.get('player2_username')
        player3_username = request.data.get('player3_username')
        player4_username = request.data.get('player4_username')

        if not player2_username or not player3_username or not player4_username:
            return Response({
                'status': 'error',
                'message': 'Please provide all 4 players'
            }, status=status.HTTP_400_BAD_REQUEST)

        player2 = get_object_or_404(Player, username=player2_username)
        player3 = get_object_or_404(Player, username=player3_username)
        player4 = get_object_or_404(Player, username=player4_username)

        # Create a new tournament
        tournament = Tournament.objects.create(
            player1=player,
            player2=player2,
            player3=player3,
            player4=player4,
        )
        
        # Notify all players
        NotificationConsumer.sendTournamentNotification(player.username ,player2)
        NotificationConsumer.sendTournamentNotification(player.username ,player3)
        NotificationConsumer.sendTournamentNotification(player.username ,player4)
        
        players = self.construct_players(player, player2, player3, player4)
        return Response({
            'status': 'success',
            'message': 'Tournament created',
            'tournament_id': str(tournament.id),
            'players': players
        }, status=status.HTTP_201_CREATED)
    
    def construct_players(self, player1, player2, player3, player4):
        # Create a dictionary containing the players' data
        players_data = {
            'player1': {
                'username': player1.username,
                'tournament_name': player1.tournament_name,
                'avatar': player1.avatar_url,
            },
            'player2': {
                'username': player2.username,
                'tournament_name': player2.tournament_name,
                'avatar': player2.avatar_url,
            },
            'player3': {
                'username': player3.username,
                'tournament_name': player3.tournament_name,
                'avatar': player3.avatar_url,
            },
            'player4': {
                'username': player4.username,
                'tournament_name': player4.tournament_name,
                'avatar': player4.avatar_url,
            }
        }
        return players_data
    
class TournamentEndView(APIView):
    permission_classes = (IsAuthenticated,)
    
    def post(self, request):
        tournament_data = request.data
        logger.info(f'Tournament end data received: {tournament_data}')
        
        try:
            tournament_id = tournament_data['tournament_id']
            results = tournament_data['results']
        except KeyError as e:
            return Response({
                'status': 'error',
                'message': f'Missing required field: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        tournament = get_object_or_404(Tournament, id=tournament_id)
        
        if tournament.status == Tournament.Status.FINISHED:
            return Response({
                'status': 'error',
                'message': 'This tournament has already been finished.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            self.process_tournament_results(tournament, results)
        except Exception as e:
            logger.error(f'Error processing tournament results: {str(e)}')
            return Response({
                'status': 'error',
                'message': 'An error occurred while processing the tournament results.'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        return Response({
            'status': 'success',
            'message': 'Tournament ended successfully.',
            'winner': tournament.winner.username,
            'tournament_id': tournament.id
        }, status=status.HTTP_200_OK)
    
    def process_tournament_results(self, tournament, results):
        final_match = results[-1]
        winner_username = final_match['winner']['username']
        winner = get_object_or_404(Player, username=winner_username)
        
        tournament.winner = winner
        tournament.status = Tournament.Status.FINISHED
        tournament.save()
        
        for match in results:
            self.create_pong_game(tournament, match)
    
    def create_pong_game(self, tournament, match):
        player1 = get_object_or_404(Player, username=match['players'][0]['username'])
        player2 = get_object_or_404(Player, username=match['players'][1]['username'])
        winner = get_object_or_404(Player, username=match['winner']['username'])
        
        # Update player stats
        winner.wins += 1
        loser = player1 if winner == player2 else player2
        loser.losses += 1
        winner.save()
        loser.save()
        
        PongGame.objects.create(
            player1=player1,
            player2=player2,
            winner=winner,
            player1_score=match['score'][0],
            player2_score=match['score'][1],
            status=PongGame.Status.FINISHED,
            created_at=timezone.now()
        )