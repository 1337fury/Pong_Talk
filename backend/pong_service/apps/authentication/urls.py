from .views import *
from django.urls import path

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('players/', PlayerListView.as_view(), name='player_list'),
    path('profile/<str:username>/',
         PlayerPublicProfileView.as_view(), name='player_profile'),
    path('login/', LoginView.as_view(), name='login'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('update/', UpdatePlayerInfoView.as_view(), name='update_player'),
    path('update-password/', ChangePasswordView.as_view(), name='update_password'),
    path('avatar/', UpdateAvatarView.as_view(), name='avatar'),
]
