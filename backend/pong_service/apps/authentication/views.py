from rest_framework.generics import ListCreateAPIView, ListAPIView
from .serializers import *
from .models import Player
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework import generics, status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.auth import login, logout
from pong_service.permissions import IsUnauthenticated
from pong_service.apps.chat.models import BlockedUsers
from django.db.models import Q
from django.http import Http404

class LogoutView(APIView):
    """
    View for logging out a user.

    Requires the user to be authenticated.
    """

    permission_classes = (IsAuthenticated,)

    def get(self, request):
        """
        Handle POST request to log out the user.

        :param request: The HTTP request object.
        :return: A Response object with a success message.
        """
        logout(request)
        return Response({'message': 'Logout successful'}, status=status.HTTP_200_OK)


class LoginView(APIView):
    """
    View for handling user login.
    """
    permission_classes = (AllowAny,)
    serializer_class = LoginSerializer

    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        if serializer.is_valid():
            user = serializer.validated_data['user']
            login(request, user)
            return Response({
                'user_id': user.id,
                'username': user.username,
                'message': 'Login successful'
            }, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class RegisterView(ListCreateAPIView):
    """
    View for registering a new player.

    Inherits from ListCreateAPIView, which provides GET (list) and POST (create) methods.
    """
    queryset = Player.objects.all()
    serializer_class = PlayerRegistrationSerializer
    permission_classes = (IsUnauthenticated,)


class PlayerListView(ListAPIView):
    """
    API view that returns a list of all players.

    Inherits from ListAPIView and uses PlayerListSerializer
    to serialize the queryset.

    Requires authentication for access.
    """
    queryset = Player.objects.all()
    serializer_class = PlayerListSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """
        Exclude blocked users from the queryset.
        """
        blocked_users = BlockedUsers.objects.filter(
            Q(player=self.request.user) | Q(blockedUser=self.request.user)
        )
        blocked_user_ids = blocked_users.values_list('blockedUser', flat=True)
        return Player.objects.exclude(id__in=blocked_user_ids)


class PlayerPublicProfileView(generics.RetrieveAPIView):
    """
    API view to retrieve the public profile of a player.
    """
    queryset = Player.objects.all()
    serializer_class = PlayerListSerializer
    lookup_field = 'username'
    permission_classes = [IsAuthenticated]

    def get_object(self):
        """
        Exclude blocked users from the queryset.
        """
        username = self.kwargs['username']
        if BlockedUsers.objects.filter(
            Q(player=self.request.user, blockedUser__username=username) |
            Q(player__username=username, blockedUser=self.request.user)
        ).exists():
            raise Http404("Player not found")
        return super().get_object()
